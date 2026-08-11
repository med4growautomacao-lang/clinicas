-- A etapa "Entregue/Pago" passa a receber o card sozinho, quando a entrega e registrada.
-- Pedido do dono em 11/08.
--
-- ⚠️ O QUE IMPEDIA ISSO, e nao era falta de codigo: a etapa da Metaltres estava com `slug` NULO.
-- `set_ticket_stage` tem uma regra que existe por bom motivo: card ja RESOLVIDO (com outcome) que
-- volta para uma etapa que nao seja 'ganho' nem 'perdido' significa "comecou outra negociacao", e
-- entao ela FECHA o card e ABRE UM NOVO.
-- Como slug nulo nao e 'ganho' nem 'perdido', mandar o card ganho para "Entregue/Pago" faria
-- exatamente isso: a venda ficaria no card fechado e apareceria um card NOVO e VAZIO do mesmo
-- cliente no funil, a cada entrega registrada. Silencioso e irreversivel na pratica.
--
-- 📌 A correcao tem tres partes, e as tres sao necessarias:
--   1. a etapa ganha o slug 'entregue' (sem chave, o motor nao a enxerga);
--   2. `set_ticket_stage` aprende que 'entregue' e etapa DE DEPOIS DA VENDA, e nao volta de
--      negociacao: entrar nela NAO abre ciclo novo;
--   3. `marcar_orcamento_entregue` move o card, e so quando NAO sobra pedido por entregar.
--
-- ⚠️ A parte 3 importa porque o mesmo card aceita VARIAS vendas desde 10/08: com dois pedidos
-- ganhos, entregar o primeiro nao pode carimbar o card inteiro como entregue.
--
-- ⚠️ A parte 2 mexe no motor de etapas, que e de TODOS os tenants. E segura porque nenhuma etapa
-- do sistema usava o slug 'entregue' (conferido: 0 linhas antes desta migration), entao para todo
-- mundo o comportamento fica identico ate que alguem crie a etapa de proposito.
--
-- PROVADO em transacao revertida (11/08), no card do cliente PEDRO, que tem DUAS vendas:
--   entregar o #95 -> "faltam 1 pedido", card continua em "Ganho";
--   entregar o #99 -> card vai para "Entregue/Pago", outcome segue 'ganho', status segue 'open',
--                     o cliente continua com 1 card so (nenhum card novo vazio) e as 2 vendas
--                     seguem intactas.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) A etapa ganha chave. Escopo estreito: so etapa SEM slug cujo nome fala de entrega.
UPDATE public.funnel_stages
   SET slug = 'entregue'
 WHERE slug IS NULL AND name ILIKE '%entregue%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) O motor aprende que 'entregue' vem DEPOIS da venda.
CREATE OR REPLACE FUNCTION public.set_ticket_stage(p_ticket_id uuid, p_new_stage_id uuid, p_source text DEFAULT 'unknown'::text, p_actor text DEFAULT NULL::text, p_on_resolved text DEFAULT 'new_cycle'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket     RECORD;
  v_new_slug   text;
  v_new_ticket uuid;
  v_resolved   boolean;
BEGIN
  PERFORM set_config('app.stage_source', COALESCE(NULLIF(p_source, ''), 'unknown'), true);
  PERFORM set_config('app.stage_actor', COALESCE(p_actor, auth.uid()::text, ''), true);

  SELECT id, lead_id, stage_id, clinic_id, status, outcome
    INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  -- Guard de tenant: barra chamador authenticated de outra clínica. Passa para service_role e
  -- para chamada sem JWT (cron/psql/trigger interno).
  PERFORM public.assert_clinic_access(v_ticket.clinic_id);

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  IF v_ticket.stage_id = p_new_stage_id THEN
    RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                              'new_stage_id', p_new_stage_id, 'new_cycle', false, 'noop', true);
  END IF;

  v_resolved := (v_ticket.outcome IS NOT NULL OR v_ticket.status = 'closed');

  -- ⚠️ 'entregue' entra nesta lista junto de 'ganho' e 'perdido' porque e etapa de DEPOIS do
  -- desfecho (o pedido saiu da fabrica), e nao uma volta para a negociacao. Sem isso, registrar a
  -- entrega fecharia o card da venda e abriria um card novo e vazio para o mesmo cliente.
  IF v_resolved
     AND v_ticket.lead_id IS NOT NULL   -- órfão não se reproduz
     AND v_new_slug IS DISTINCT FROM 'ganho'
     AND v_new_slug IS DISTINCT FROM 'perdido'
     AND v_new_slug IS DISTINCT FROM 'entregue' THEN

    IF p_on_resolved = 'block' THEN
      RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                                'blocked', true, 'reason', 'ticket_resolved');

    ELSIF p_on_resolved = 'new_cycle' THEN
      IF v_ticket.status <> 'closed' THEN
        UPDATE tickets SET status = 'closed', closed_at = COALESCE(closed_at, now())
        WHERE id = v_ticket.id;
      END IF;
      INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
      VALUES (v_ticket.clinic_id, v_ticket.lead_id, p_new_stage_id, 'open', now())
      RETURNING id INTO v_new_ticket;
      RETURN jsonb_build_object('success', true, 'ticket_id', v_new_ticket,
                                'previous_ticket_id', v_ticket.id,
                                'new_stage_id', p_new_stage_id, 'new_cycle', true);

    END IF;
  END IF;

  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;
  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                            'new_stage_id', p_new_stage_id, 'new_cycle', false);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Registrar a entrega move o card, quando nao sobra pedido por entregar.
CREATE OR REPLACE FUNCTION public.marcar_orcamento_entregue(
  p_orcamento_id uuid,
  p_data date DEFAULT (now() at time zone 'America/Sao_Paulo')::date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc     public.orcamentos%ROWTYPE;
  v_ts      timestamptz;
  v_itens   int := 0;
  v_faltam  int := 0;
  v_stage   uuid;
  v_moveu   jsonb := null;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF v_orc.status <> 'aprovado' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_nao_aprovado', 'status', v_orc.status);
  END IF;
  IF v_orc.entregue_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_done', true, 'entregue_at', v_orc.entregue_at);
  END IF;

  v_ts := (p_data::timestamp + interval '12 hour');

  INSERT INTO public.inventory_movements (clinic_id, item_id, type, qty, reason, created_at, created_by, notes)
  SELECT r.clinic_id, r.item_id, 'saida', r.qty, 'venda', v_ts, auth.uid(),
         'Entrega do pedido #' || v_orc.number
  FROM public.stock_reservations r
  WHERE r.status = 'ativa' AND r.orcamento_id = p_orcamento_id;
  GET DIAGNOSTICS v_itens = ROW_COUNT;

  UPDATE public.stock_reservations
     SET status = 'baixada', settled_at = v_ts
   WHERE status = 'ativa' AND orcamento_id = p_orcamento_id;

  UPDATE public.orcamentos
     SET entregue_at = v_ts, entregue_por = auth.uid()
   WHERE id = p_orcamento_id;

  -- ⚠️ O card so anda quando NAO sobra pedido por entregar: com o mesmo card aceitando varias
  -- vendas, entregar a primeira nao pode carimbar o cliente inteiro como entregue.
  IF v_orc.approved_ticket_id IS NOT NULL THEN
    SELECT count(*) INTO v_faltam
      FROM public.orcamentos o
     WHERE o.approved_ticket_id = v_orc.approved_ticket_id
       AND o.status = 'aprovado'
       AND o.entregue_at IS NULL
       AND o.id <> p_orcamento_id;

    IF v_faltam = 0 THEN
      SELECT id INTO v_stage FROM public.funnel_stages
       WHERE clinic_id = v_orc.clinic_id AND slug = 'entregue' LIMIT 1;

      -- Clinica sem a etapa segue sem mover: a entrega e do pedido, o funil e opcional.
      IF v_stage IS NOT NULL THEN
        -- ⚠️ Bloco proprio: mover o card e o ENFEITE, a baixa de estoque e o que importa. Se o
        -- funil recusar por qualquer motivo, a entrega continua valendo e o erro vai para a Central.
        BEGIN
          v_moveu := public.set_ticket_stage(v_orc.approved_ticket_id, v_stage, 'entrega_orcamento');
        EXCEPTION WHEN OTHERS THEN
          PERFORM public.log_system_error(
            'orcamento', 'entrega_nao_moveu_card',
            'Entrega registrada, mas o card não foi para a etapa de entregue',
            'warn', v_orc.clinic_id,
            jsonb_build_object('orcamento_id', p_orcamento_id, 'ticket_id', v_orc.approved_ticket_id,
                               'stage_id', v_stage, 'sqlstate', SQLSTATE, 'message', SQLERRM), false);
        END;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'itens_baixados', v_itens, 'entregue_at', v_ts,
                            'pedidos_restantes', v_faltam, 'card_movido', v_moveu);
EXCEPTION WHEN OTHERS THEN
  PERFORM public.log_system_error(
    'estoque', 'baixa_entrega_falhou',
    'Falha ao baixar estoque na entrega do orçamento #' || coalesce(v_orc.number::text, '?'),
    'error', v_orc.clinic_id,
    jsonb_build_object('orcamento_id', p_orcamento_id, 'data', p_data,
                       'sqlstate', SQLSTATE, 'message', SQLERRM), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'baixa_falhou', 'message', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.marcar_orcamento_entregue(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_orcamento_entregue(uuid, date) TO authenticated, service_role;
