-- REVERSAO do status 'pago' do orcamento (decisao do dono, 11/08, no mesmo dia em que foi criado).
--
-- 📌 O MOTIVO e conceitual, e vale registrar: o dono percebeu que APROVAR o orcamento e o MESMO
-- evento de passar o card para Ganho. Aprovar ja lanca a venda (`conversions`), ja lanca a receita
-- (`financial_transactions`) e ja pergunta, no proprio modal de aprovacao, a forma de pagamento e
-- se esta pago ou pendente. Ou seja: quem responde "foi pago?" e `financial_transactions.status`,
-- desde sempre. Um status 'pago' no orcamento era uma SEGUNDA resposta para a mesma pergunta, e
-- obrigaria a equipe a marcar a mesma coisa em dois lugares.
--
-- ⚠️ E a reversao fecha um furo real que a edicao-ate-pago tinha aberto: `save_orcamento` passou a
-- deixar editar orcamento APROVADO, e arrastava junto o valor da venda e da receita. So que quem
-- cria a reserva de estoque e a ordem de producao e `provision_orcamento`, que roda UMA vez, na
-- aprovacao, e nao e chamada por `save_orcamento` nem por trigger nenhuma da tabela (conferido no
-- banco vivo, 11/08). Trocar os itens de um orcamento aprovado deixava a reserva de estoque com os
-- itens ANTIGOS, e a entrega baixaria a mercadoria errada, sem erro nenhum na tela.
--
-- Entao a trava volta para onde estava: orcamento aprovado nao se edita. Quem precisar corrigir
-- cancela a venda no Kanban (que sabe desfazer conversao, receita e reserva juntas) e refaz.
--
-- Nada a migrar: 0 orcamentos com status 'pago' e 0 com `pago_at` preenchido (conferido antes).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Volta o vocabulario de status para os 6 de sempre.
ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_status_check;
ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_status_check
  CHECK (status = ANY (ARRAY['rascunho','enviado','aprovado','recusado','expirado','substituido']));

ALTER TABLE public.orcamentos DROP COLUMN IF EXISTS pago_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Transicoes: sem 'pago'.
CREATE OR REPLACE FUNCTION public.update_orcamento_status(p_orcamento_id uuid, p_status text, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
BEGIN
  IF p_status NOT IN ('enviado', 'recusado', 'expirado', 'substituido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
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
-- 3) Correcao de status na mao: continua existindo (pedido separado do dono), sem 'pago' e sem data.
--    ⚠️ DROP antes do CREATE: a assinatura perde o `p_pago_em`, e um CREATE OR REPLACE com lista de
--    argumentos diferente criaria uma SEGUNDA sobrecarga em vez de substituir.
DROP FUNCTION IF EXISTS public.corrigir_status_orcamento(uuid, text, date);

CREATE OR REPLACE FUNCTION public.corrigir_status_orcamento(
  p_orcamento_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
BEGIN
  IF p_status NOT IN ('rascunho','enviado','aprovado','recusado','expirado','substituido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF v_orc.status = p_status THEN
    RETURN jsonb_build_object('success', true, 'sem_mudanca', true);
  END IF;

  -- ⚠️ Desfazer venda NAO se faz por aqui: existe conversao e lancamento financeiro ligados, e
  -- mexer so no status deixaria receita orfa. O caminho e "Cancelar venda" no Kanban.
  IF v_orc.status = 'aprovado' AND v_orc.conversion_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'tem_venda_lancada');
  END IF;

  -- Entrar em 'aprovado' por correcao NAO lanca venda: aprovar de verdade e pelo botao Aprovar,
  -- que cria conversao, receita e ordem de producao. Um status carimbado a mao criaria "venda" sem
  -- dinheiro nenhum atras.
  IF p_status = 'aprovado' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'use_aprovar');
  END IF;

  UPDATE public.orcamentos SET
    status  = p_status,
    sent_at = CASE WHEN p_status = 'enviado' THEN COALESCE(sent_at, now()) ELSE sent_at END
  WHERE id = p_orcamento_id;

  PERFORM log_system_error(
    'orcamento', 'status_corrigido',
    'Status do orçamento alterado à mão',
    'info', v_orc.clinic_id,
    jsonb_build_object('orcamento_id', p_orcamento_id, 'numero', v_orc.number,
                       'de', v_orc.status, 'para', p_status), false);

  RETURN jsonb_build_object('success', true, 'id', p_orcamento_id, 'status', p_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.corrigir_status_orcamento(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_status_orcamento(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Edicao volta a parar na aprovacao, e o remendo que arrastava venda/receita sai junto: sem
--    edicao de aprovado, ele nao tem mais o que fazer.
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
    -- ⚠️ Aprovado NAO se edita: aprovar e a venda. Alem da receita ja lancada, a reserva de estoque
    -- e a ordem de producao sairam de `provision_orcamento`, que roda so na aprovacao; editar aqui
    -- deixaria o estoque reservado com os itens antigos.
    IF v_cur.status NOT IN ('rascunho', 'enviado') THEN
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
      status         = CASE WHEN v_cur.status = 'rascunho' THEN p_status ELSE v_cur.status END,
      sent_at        = CASE WHEN v_cur.status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;
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
-- 5) Entrega e cancelamento de venda voltam a olhar so 'aprovado'.
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

  -- Cancelamento mirando UMA venda so (card com varias): desfaz apenas o orcamento daquela.
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
