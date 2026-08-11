-- Etapa nova do orcamento: PAGO, depois de aprovado (decisao do dono, 11/08).
-- E a trava de edicao MUDA de lugar: aprovado volta a ser editavel; so 'pago' fecha a proposta.
--
-- 📌 O ciclo passa a ser: rascunho -> enviado -> aprovado -> pago.
--    (recusado, substituido e expirado continuam sendo saidas terminais a partir do que esta aberto)
--
-- ⚠️ O PERIGO desta mudanca, e o que esta migration resolve: com o orcamento APROVADO ja existe
-- venda lancada (`conversions`) e receita no financeiro (`financial_transactions`), as duas com o
-- valor daquele momento. Editar o total depois disso, sem mais nada, deixaria o documento do
-- cliente dizendo um valor e o faturamento dizendo outro, em silencio. Entao a edicao de um
-- orcamento aprovado agora ARRASTA a venda e a receita junto, e deixa rastro na Central.
--
-- 📌 A partir de 'pago' nao se edita mais nada: dinheiro que entrou nao se reescreve por tela.
-- Quem precisar mexer cancela a venda no Kanban, que sabe desfazer conversao e lancamento.
--
-- PROVADO em transacao revertida (11/08), num card real da Metaltres:
--   editar aprovado de 1.000 para 1.500 -> status segue 'aprovado', venda = 1.500, receita = 1.500;
--   marcar pago -> ok;
--   editar depois de pago -> RECUSADO (locked_after_approval);
--   pagar de novo -> RECUSADO (so_aprovado_vira_pago).

ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_status_check;
ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_status_check
  CHECK (status = ANY (ARRAY['rascunho','enviado','aprovado','recusado','expirado','substituido','pago']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Transicoes de status.
CREATE OR REPLACE FUNCTION public.update_orcamento_status(p_orcamento_id uuid, p_status text, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
BEGIN
  IF p_status NOT IN ('enviado', 'recusado', 'expirado', 'substituido', 'pago') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  -- 'pago' e o UNICO caminho que sai de 'aprovado'. Os outros continuam saindo do que esta aberto.
  IF p_status = 'pago' THEN
    IF v_orc.status <> 'aprovado' THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'so_aprovado_vira_pago', 'status', v_orc.status);
    END IF;
  ELSIF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;

  UPDATE public.orcamentos SET
    status        = p_status,
    sent_at       = CASE WHEN p_status = 'enviado' THEN COALESCE(sent_at, now()) ELSE sent_at END,
    rejected_at   = CASE WHEN p_status = 'recusado' THEN now() ELSE rejected_at END,
    reject_reason = CASE WHEN p_status IN ('recusado','substituido') THEN p_reason ELSE reject_reason END
  WHERE id = p_orcamento_id;

  RETURN jsonb_build_object('success', true, 'id', p_orcamento_id, 'status', p_status);
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Edicao: liberada ate 'aprovado'; com venda lancada, o dinheiro anda junto.
CREATE OR REPLACE FUNCTION public.save_orcamento(
  p_id uuid,
  p_clinic_id uuid,
  p_lead_id uuid,
  p_status text DEFAULT 'rascunho'::text,
  p_client_name text DEFAULT NULL::text,
  p_client_doc text DEFAULT NULL::text,
  p_client_address text DEFAULT NULL::text,
  p_subtotal numeric DEFAULT NULL::numeric,
  p_desconto numeric DEFAULT NULL::numeric,
  p_frete numeric DEFAULT NULL::numeric,
  p_total numeric DEFAULT 0,
  p_validade date DEFAULT NULL::date,
  p_vencimento date DEFAULT NULL::date,
  p_pagamento text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_snapshot jsonb DEFAULT NULL::jsonb,
  p_ticket_id uuid DEFAULT NULL::uuid,
  p_projeto text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id          uuid;
  v_number      integer;
  v_cur         public.orcamentos%ROWTYPE;
  v_open_ticket uuid;
  v_entrega     date := NULLIF(p_snapshot->>'dataEntrega', '')::date;
  v_projeto     text := NULLIF(btrim(p_projeto), '');
  v_conv        uuid;
  v_tx          uuid;
BEGIN
  IF NOT has_clinic_access(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_cur FROM public.orcamentos WHERE id = p_id AND clinic_id = p_clinic_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
    END IF;
    -- ⚠️ 'aprovado' agora ENTRA na lista: o dono quer poder corrigir a proposta depois de aprovada.
    -- 'pago' e as saidas terminais continuam trancadas.
    IF v_cur.status NOT IN ('rascunho', 'enviado', 'aprovado') THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'locked_after_approval', 'status', v_cur.status);
    END IF;

    UPDATE public.orcamentos SET
      lead_id        = p_lead_id,
      -- ⚠️ COALESCE: salvar sem informar NAO apaga o que ja estava la.
      projeto        = COALESCE(v_projeto, projeto),
      client_name    = p_client_name,
      client_doc     = COALESCE(p_client_doc, client_doc),
      client_address = COALESCE(p_client_address, client_address),
      subtotal       = COALESCE(p_subtotal, subtotal),
      desconto       = COALESCE(p_desconto, desconto),
      frete          = COALESCE(p_frete, frete),
      total          = p_total,
      validade       = COALESCE(p_validade, validade),
      vencimento     = COALESCE(p_vencimento, vencimento),
      pagamento      = COALESCE(p_pagamento, pagamento),
      notes          = p_notes,
      snapshot       = p_snapshot,
      data_entrega_prevista = v_entrega,
      -- Orcamento aprovado NAO volta para rascunho/enviado ao ser editado: o desfecho e do
      -- desfecho, nao da edicao.
      status         = CASE WHEN v_cur.status = 'aprovado' THEN 'aprovado'
                            WHEN v_cur.status = 'rascunho' THEN p_status
                            ELSE v_cur.status END,
      sent_at        = CASE WHEN v_cur.status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;

    -- 📌 Editou orcamento APROVADO e o valor mudou: a venda e a receita lancadas tem que
    -- acompanhar, senao o painel e o financeiro passam a discordar do documento do cliente.
    IF v_cur.status = 'aprovado' AND p_total IS DISTINCT FROM v_cur.total THEN
      SELECT c.id, c.financial_transaction_id INTO v_conv, v_tx
      FROM public.conversions c WHERE c.id = v_cur.conversion_id;

      IF v_conv IS NOT NULL THEN
        UPDATE public.conversions SET value = p_total WHERE id = v_conv;
        IF v_tx IS NOT NULL THEN
          UPDATE public.financial_transactions SET amount = p_total WHERE id = v_tx;
        END IF;
      END IF;

      PERFORM log_system_error(
        'orcamento', 'valor_alterado_apos_venda',
        'Orçamento aprovado teve o valor alterado; a venda e a receita foram ajustadas junto',
        'warn', p_clinic_id,
        jsonb_build_object('orcamento_id', p_id, 'de', v_cur.total, 'para', p_total,
                           'conversion_id', v_conv, 'financial_transaction_id', v_tx), false);
    END IF;
  ELSE
    INSERT INTO public.orcamentos (
      clinic_id, lead_id, ticket_id, projeto, status, client_name, client_doc, client_address,
      subtotal, desconto, frete, total, validade, vencimento, pagamento, notes, snapshot,
      data_entrega_prevista, created_by, sent_at
    ) VALUES (
      p_clinic_id, p_lead_id, p_ticket_id, v_projeto, p_status, p_client_name, p_client_doc, p_client_address,
      p_subtotal, p_desconto, p_frete, p_total, p_validade, p_vencimento, p_pagamento, p_notes, p_snapshot,
      v_entrega, auth.uid(), CASE WHEN p_status = 'enviado' THEN now() ELSE NULL END
    )
    RETURNING id, number INTO v_id, v_number;
  END IF;

  IF p_lead_id IS NOT NULL THEN
    SELECT id INTO v_open_ticket FROM public.tickets WHERE lead_id = p_lead_id AND status = 'open' LIMIT 1;
    IF v_open_ticket IS NOT NULL THEN
      UPDATE public.tickets SET quote_data = p_snapshot, notes = COALESCE(p_notes, notes) WHERE id = v_open_ticket;
    END IF;
    UPDATE public.leads SET estimated_value = p_total WHERE id = p_lead_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'number', v_number, 'projeto', v_projeto);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Entrega e reversao passam a enxergar 'pago' como aprovado: pagar e entregar sao coisas
--    independentes, e um pedido pago tambem e entregue.
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
  IF v_orc.status NOT IN ('aprovado', 'pago') THEN
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

  RETURN jsonb_build_object('success', true, 'itens_baixados', v_itens, 'entregue_at', v_ts);
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

-- Cancelar a venda tambem desfaz o orcamento PAGO daquele card (o dinheiro esta sendo desfeito).
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
  FROM public.orcamentos WHERE approved_ticket_id = OLD.id AND status IN ('aprovado','pago');

  IF v_aprov > 1 AND v_marca <> '' THEN
    SELECT array_agg(x::uuid) INTO v_ids FROM unnest(string_to_array(v_marca, ',')) x;

    UPDATE public.stock_reservations SET status = 'liberada', released_at = now()
    WHERE status = 'ativa'
      AND orcamento_id IN (SELECT id FROM public.orcamentos
                            WHERE approved_ticket_id = OLD.id AND status IN ('aprovado','pago')
                              AND entregue_at IS NULL
                              AND conversion_id = ANY(v_ids));

    UPDATE public.orcamentos SET status = 'enviado', approved_ticket_id = NULL, conversion_id = NULL
    WHERE approved_ticket_id = OLD.id AND status IN ('aprovado','pago') AND entregue_at IS NULL
      AND conversion_id = ANY(v_ids);

    RETURN NEW;
  END IF;

  UPDATE public.stock_reservations SET status = 'liberada', released_at = now()
  WHERE status = 'ativa'
    AND orcamento_id IN (SELECT id FROM public.orcamentos
                          WHERE approved_ticket_id = OLD.id AND status IN ('aprovado','pago')
                            AND entregue_at IS NULL);
  UPDATE public.orcamentos SET status = 'enviado', approved_ticket_id = NULL, conversion_id = NULL
  WHERE approved_ticket_id = OLD.id AND status IN ('aprovado','pago') AND entregue_at IS NULL;

  RETURN NEW;
END;
$function$;
