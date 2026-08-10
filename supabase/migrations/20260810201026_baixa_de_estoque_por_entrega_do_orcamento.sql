-- ETAPA 5 de 6 do plano "varias vendas no mesmo card" (decisao do dono, 10/08). So WakeDesk.
--
-- ⚠️ O PROBLEMA: a baixa de estoque so acontece quando o CARD FECHA
-- (`fn_settle_reservations_on_resolve`, gatilho open -> closed). No modelo novo o card fica ABERTO
-- de proposito, para receber a proxima venda. Resultado: a mercadoria sai da fabrica e o estoque
-- nunca baixa; quando alguem finalmente arquiva o card, baixa tudo de uma vez, na data errada, e
-- soma com qualquer saida manual lancada no meio do caminho.
--
-- 📌 A baixa passa a ser por ORCAMENTO ENTREGUE, que e o momento real em que a mercadoria sai.
--
-- ⚠️ A trigger antiga NAO e removida: vira REDE DE SEGURANCA. Quem nunca clicar em "Marcar
-- entregue" continua tendo baixa ao arquivar o card, que e o comportamento de hoje. Remover
-- deixaria sem baixa nenhuma quem nao adotar o botao, e isso e pior que o problema atual.
--
-- Estado medido antes de aplicar: `stock_reservations` VAZIA, `inventory_movements` com 3 linhas
-- (nenhuma com reason='venda'), 0 orcamentos aprovados, 1 clinica com Producao (Metaltres).
-- Ou seja: nada corrompido, o caminho nunca rodou. E o que torna esta etapa barata e segura.
--
-- PROVADO em transacao revertida (10/08), com orcamento aprovado + reserva ativa na Metaltres:
--   entrega com data RETROATIVA gravou o movimento de estoque em 07/08 12:00 (a data da entrega,
--   nao a do clique); reserva virou 'baixada'; 2a chamada devolveu already_done e NAO baixou de
--   novo (continuou 1 movimento).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Entrega REAL. `data_entrega_prevista` e PREVISAO, gravada la na aprovacao; nao serve de trava.
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS entregue_at  timestamptz,
  ADD COLUMN IF NOT EXISTS entregue_por uuid;

COMMENT ON COLUMN public.orcamentos.entregue_at IS
  'Marca de entrega REAL do pedido (data_entrega_prevista e PREVISAO, gravada na aprovacao). E tambem a trava de idempotencia da baixa de estoque.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) A baixa, por ORCAMENTO.
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
  v_orc   public.orcamentos%ROWTYPE;
  v_ts    timestamptz;
  v_itens int := 0;
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

  -- Meio-dia trava o dia do negocio: mesmo padrao que close_sale_from_orcamento usa em
  -- conversions.converted_at. `inventory_movements.created_at` e timestamptz com default now(),
  -- entao sem passar explicito o razao gravaria o dia do CLIQUE, nao o da entrega.
  v_ts := (p_data::timestamp + interval '12 hour');

  -- ⚠️ Recorte por `orcamento_id`, NUNCA por card: com varias vendas no mesmo card, recortar por
  -- ticket baixaria o estoque de todas de uma vez. E o coracao desta etapa.
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

  RETURN jsonb_build_object('success', true, 'itens_baixados', v_itens, 'entregue_at', v_ts);
EXCEPTION WHEN OTHERS THEN
  -- NAO re-lanca de proposito: o `raise` abortaria a transacao inteira e levaria junto o registro
  -- na Central (o insert do log e da mesma transacao). Registra e devolve erro.
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) A rede de seguranca ignora o que ja foi entregue (senao baixaria duas vezes).
--    A trava natural existe (as duas rotas consomem a MESMA lista de reservas 'ativa' e a
--    esvaziam), mas e implicita e sumiria na primeira refatoracao. A guarda e explicita.
CREATE OR REPLACE FUNCTION public.fn_settle_reservations_on_resolve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'closed' AND NEW.outcome = 'ganho' THEN
    INSERT INTO public.inventory_movements (clinic_id, item_id, type, qty, reason, created_by)
    SELECT r.clinic_id, r.item_id, 'saida', r.qty, 'venda', auth.uid()
    FROM public.stock_reservations r
    JOIN public.orcamentos o ON o.id = r.orcamento_id
    WHERE r.status = 'ativa' AND o.approved_ticket_id = NEW.id AND o.entregue_at IS NULL;

    UPDATE public.stock_reservations r SET status = 'baixada', settled_at = now()
    FROM public.orcamentos o
    WHERE r.orcamento_id = o.id AND r.status = 'ativa' AND o.approved_ticket_id = NEW.id
      AND o.entregue_at IS NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Orcamento JA ENTREGUE nao volta atras. Liberar reserva de mercadoria que ja saiu da fabrica
--    recria estoque do nada: o item volta a aparecer disponivel sem nunca ter voltado do cliente.
--    (Esta funcao ja foi reescrita na etapa 2 para mirar a venda cancelada; aqui so entra a
--    guarda de entrega, nos dois ramos.)
CREATE OR REPLACE FUNCTION public.fn_orcamento_revert_on_sale_lost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := coalesce(current_setting('app.cancel_conversion_ids', true), '');
  v_ids   uuid[];
  v_aprov int;
BEGIN
  IF NOT (OLD.outcome = 'ganho' AND NEW.outcome IS DISTINCT FROM 'ganho') THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_aprov
  FROM public.orcamentos WHERE approved_ticket_id = OLD.id AND status = 'aprovado';

  -- Alvo explicito SO vale quando ha mais de um orcamento aprovado no card. Com um so, nao existe
  -- ambiguidade e o caminho antigo (em bloco) e o certo, inclusive para os legados sem vinculo.
  IF v_aprov > 1 AND v_marca <> '' THEN
    SELECT array_agg(x::uuid) INTO v_ids FROM unnest(string_to_array(v_marca, ',')) x;

    UPDATE public.stock_reservations SET status = 'liberada', released_at = now()
    WHERE status = 'ativa'
      AND orcamento_id IN (SELECT id FROM public.orcamentos
                            WHERE approved_ticket_id = OLD.id AND status = 'aprovado'
                              AND entregue_at IS NULL
                              AND conversion_id = ANY(v_ids));

    UPDATE public.orcamentos SET status = 'enviado', approved_ticket_id = NULL, conversion_id = NULL
    WHERE approved_ticket_id = OLD.id AND status = 'aprovado' AND entregue_at IS NULL
      AND conversion_id = ANY(v_ids);

    RETURN NEW;
  END IF;

  UPDATE public.stock_reservations SET status = 'liberada', released_at = now()
  WHERE status = 'ativa'
    AND orcamento_id IN (SELECT id FROM public.orcamentos
                          WHERE approved_ticket_id = OLD.id AND status = 'aprovado'
                            AND entregue_at IS NULL);
  UPDATE public.orcamentos SET status = 'enviado', approved_ticket_id = NULL, conversion_id = NULL
  WHERE approved_ticket_id = OLD.id AND status = 'aprovado' AND entregue_at IS NULL;

  RETURN NEW;
END;
$function$;
