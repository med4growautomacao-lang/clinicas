-- Fase 1 (frontend): save_orcamento ganhou p_ticket_id — carimbo histórico do ticket no
-- momento da criação (a coluna já existia no schema da Fase 0 mas nunca era preenchida).
-- Só grava no INSERT (criação); UPDATE não mexe (é stamp de criação, não muda ao editar).
CREATE OR REPLACE FUNCTION public.save_orcamento(
  p_id             uuid,
  p_clinic_id      uuid,
  p_lead_id        uuid,
  p_status         text DEFAULT 'rascunho',
  p_client_name    text DEFAULT NULL,
  p_client_doc     text DEFAULT NULL,
  p_client_address text DEFAULT NULL,
  p_subtotal       numeric DEFAULT NULL,
  p_desconto       numeric DEFAULT NULL,
  p_frete          numeric DEFAULT NULL,
  p_total          numeric DEFAULT 0,
  p_validade       date DEFAULT NULL,
  p_vencimento     date DEFAULT NULL,
  p_pagamento      text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_snapshot       jsonb DEFAULT NULL,
  p_ticket_id      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          uuid;
  v_number      integer;
  v_cur_status  text;
  v_open_ticket uuid;
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
      client_doc     = p_client_doc,
      client_address = p_client_address,
      subtotal       = p_subtotal,
      desconto       = p_desconto,
      frete          = p_frete,
      total          = p_total,
      validade       = p_validade,
      vencimento     = p_vencimento,
      pagamento      = p_pagamento,
      notes          = p_notes,
      snapshot       = p_snapshot,
      status         = CASE WHEN status = 'rascunho' THEN p_status ELSE status END,
      sent_at        = CASE WHEN status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;
  ELSE
    INSERT INTO public.orcamentos (
      clinic_id, lead_id, ticket_id, status, client_name, client_doc, client_address,
      subtotal, desconto, frete, total, validade, vencimento, pagamento, notes, snapshot,
      created_by, sent_at
    ) VALUES (
      p_clinic_id, p_lead_id, p_ticket_id, p_status, p_client_name, p_client_doc, p_client_address,
      p_subtotal, p_desconto, p_frete, p_total, p_validade, p_vencimento, p_pagamento, p_notes, p_snapshot,
      auth.uid(), CASE WHEN p_status = 'enviado' THEN now() ELSE NULL END
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
$$;

REVOKE EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid) TO authenticated;
