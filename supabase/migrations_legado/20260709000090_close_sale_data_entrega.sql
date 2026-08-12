-- Aprovação do orçamento passa a receber o PRAZO DE ENTREGA confirmado na tela de aprovar (Central),
-- gravado em orcamentos.data_entrega_prevista ANTES do provision — assim o planejamento de produção
-- (provision_orcamento: reposição só cobre se ficar pronta a tempo) usa a data que o vendedor confirmou.
-- COALESCE: se não vier data (clínica não-fábrica), mantém a existente. DROP+CREATE porque muda a assinatura.
DROP FUNCTION IF EXISTS public.close_sale_from_orcamento(uuid, text, text, date, text);

CREATE OR REPLACE FUNCTION public.close_sale_from_orcamento(
  p_orcamento_id uuid,
  p_payment_method text DEFAULT 'pix'::text,
  p_payment_status text DEFAULT 'pago'::text,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_category text DEFAULT 'Venda de produto'::text,
  p_data_entrega date DEFAULT NULL::date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc      public.orcamentos%ROWTYPE;
  v_ticket   RECORD;
  v_lead     RECORD;
  v_patient  uuid;
  v_tx_id    uuid;
  v_finalize jsonb;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_not_found'); END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;
  IF v_orc.validade IS NOT NULL AND v_orc.validade < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_vencido', 'validade', v_orc.validade);
  END IF;
  IF v_orc.lead_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_lead_linked'); END IF;

  SELECT id, outcome, status INTO v_ticket
  FROM public.tickets WHERE lead_id = v_orc.lead_id AND status = 'open' FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_open_ticket'); END IF;
  IF v_ticket.outcome = 'perdido' THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_perdido'); END IF;

  IF v_ticket.outcome = 'ganho' THEN
    UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
      data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista) WHERE id = p_orcamento_id;
    RETURN jsonb_build_object('success', true, 'already_sold', true, 'ticket_id', v_ticket.id);
  END IF;

  SELECT converted_patient_id, name, phone INTO v_lead FROM public.leads WHERE id = v_orc.lead_id;
  v_patient := v_lead.converted_patient_id;
  IF v_patient IS NULL THEN
    IF v_lead.phone IS NOT NULL THEN
      SELECT id INTO v_patient FROM public.patients
      WHERE clinic_id = v_orc.clinic_id AND phone IS NOT NULL AND normalize_br_phone(phone) = normalize_br_phone(v_lead.phone) LIMIT 1;
    END IF;
    IF v_patient IS NULL THEN
      INSERT INTO public.patients (clinic_id, name, phone) VALUES (v_orc.clinic_id, v_lead.name, v_lead.phone) RETURNING id INTO v_patient;
    END IF;
    UPDATE public.leads SET converted_patient_id = v_patient WHERE id = v_orc.lead_id AND converted_patient_id IS NULL;
  END IF;

  INSERT INTO public.financial_transactions (clinic_id, patient_id, type, category, amount, description, payment_method, status, date)
  VALUES (v_orc.clinic_id, v_patient, 'receita', p_category, v_orc.total, 'Orçamento #' || v_orc.number, p_payment_method, p_payment_status, p_payment_date)
  RETURNING id INTO v_tx_id;

  INSERT INTO public.conversions (clinic_id, lead_id, ticket_id, value, description, payment_method, converted_at, financial_transaction_id)
  VALUES (v_orc.clinic_id, v_orc.lead_id, v_ticket.id, v_orc.total, 'Orçamento #' || v_orc.number, p_payment_method, (p_payment_date::timestamp + interval '12 hour'), v_tx_id);

  SELECT public.finalize_ticket(v_ticket.id, 'ganho', NULL, NULL, false) INTO v_finalize;
  IF NOT COALESCE((v_finalize->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'finalize_ticket falhou ao aprovar orçamento %: %', p_orcamento_id, v_finalize->>'error_code';
  END IF;

  -- Grava o prazo confirmado ANTES do provision (que relê v_orc e usa data_entrega_prevista).
  UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
    data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista) WHERE id = p_orcamento_id;

  PERFORM public.provision_orcamento(p_orcamento_id);

  RETURN jsonb_build_object('success', true, 'ticket_id', v_ticket.id, 'financial_transaction_id', v_tx_id, 'patient_id', v_patient);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text, date) FROM PUBLIC, anon;
