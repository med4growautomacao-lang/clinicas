-- BUG (perda silenciosa de dado do recibo): o caminho de EDIÇÃO de save_orcamento gravava sem
-- COALESCE os campos client_doc/client_address/subtotal/desconto/frete/validade/vencimento/pagamento.
-- O OrcamentoModal do Kanban (único editor do cabeçalho) só envia client_name/total/notes/snapshot/
-- data_entrega — os demais chegam NULL. Então reeditar um orçamento que teve CPF/endereço/vencimento
-- preenchidos no recibo (via set_orcamento_print_info, na Central) APAGAVA esses dados; recibo
-- reimpresso mostrava "—".
-- FIX: COALESCE em TODOS os campos que o modal NÃO envia (edição parcial nunca zera), espelhando o
-- padrão do set_orcamento_print_info. Continuam incondicionais os que o modal edita de fato
-- (lead_id, client_name, total, notes, snapshot, data_entrega_prevista, status).
CREATE OR REPLACE FUNCTION public.save_orcamento(
  p_id uuid, p_clinic_id uuid, p_lead_id uuid, p_status text DEFAULT 'rascunho'::text,
  p_client_name text DEFAULT NULL::text, p_client_doc text DEFAULT NULL::text, p_client_address text DEFAULT NULL::text,
  p_subtotal numeric DEFAULT NULL::numeric, p_desconto numeric DEFAULT NULL::numeric, p_frete numeric DEFAULT NULL::numeric,
  p_total numeric DEFAULT 0, p_validade date DEFAULT NULL::date, p_vencimento date DEFAULT NULL::date,
  p_pagamento text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_snapshot jsonb DEFAULT NULL::jsonb,
  p_ticket_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id          uuid;
  v_number      integer;
  v_cur_status  text;
  v_open_ticket uuid;
  v_entrega     date := NULLIF(p_snapshot->>'dataEntrega', '')::date;
BEGIN
  IF NOT has_clinic_access(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT status INTO v_cur_status FROM public.orcamentos WHERE id = p_id AND clinic_id = p_clinic_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
    END IF;
    IF v_cur_status NOT IN ('rascunho', 'enviado') THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'locked_after_approval', 'status', v_cur_status);
    END IF;

    UPDATE public.orcamentos SET
      lead_id        = p_lead_id,
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
      status         = CASE WHEN status = 'rascunho' THEN p_status ELSE status END,
      sent_at        = CASE WHEN status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;
  ELSE
    INSERT INTO public.orcamentos (
      clinic_id, lead_id, ticket_id, status, client_name, client_doc, client_address,
      subtotal, desconto, frete, total, validade, vencimento, pagamento, notes, snapshot,
      data_entrega_prevista, created_by, sent_at
    ) VALUES (
      p_clinic_id, p_lead_id, p_ticket_id, p_status, p_client_name, p_client_doc, p_client_address,
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

  RETURN jsonb_build_object('success', true, 'id', v_id, 'number', v_number);
END;
$function$;