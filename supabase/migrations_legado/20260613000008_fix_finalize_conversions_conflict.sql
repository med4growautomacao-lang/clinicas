-- Corrige finalize_appointment:
-- (1) BUG: o ON CONFLICT (lead_id, financial_transaction_id) nao casava com o indice
--     parcial conversions_lead_tx_unique (que tem WHERE financial_transaction_id IS NOT NULL)
--     -> finalizar consulta com valor > 0 e lead encontrado estourava erro 42P10.
--     Ficou mais frequente apos a dedup de leads (lead quase sempre e encontrado).
-- (2) Lookup do lead por telefone passa a normalizar os dois lados (regra geral do projeto).
CREATE OR REPLACE FUNCTION public.finalize_appointment(p_appointment_id uuid, p_value numeric DEFAULT 0, p_payment_method text DEFAULT NULL::text, p_payment_status text DEFAULT 'pago'::text, p_description text DEFAULT NULL::text, p_protocol_ids uuid[] DEFAULT ARRAY[]::uuid[], p_ticket_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_apt RECORD; v_lead_id uuid; v_ganho_stage_id uuid; v_tx_id uuid; v_conv_id uuid; v_final_method text;
BEGIN
  SELECT a.*, p.phone AS patient_phone INTO v_apt
  FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id
  WHERE a.id = p_appointment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'appointment_not_found'); END IF;
  IF v_apt.status = 'realizado' THEN RETURN jsonb_build_object('success', true, 'idempotent', true, 'appointment_id', p_appointment_id); END IF;

  v_final_method := CASE WHEN p_payment_method IN ('pix','cartao','dinheiro','plano') THEN p_payment_method ELSE NULL END;
  UPDATE appointments SET status = 'realizado' WHERE id = p_appointment_id;

  IF p_value > 0 THEN
    INSERT INTO financial_transactions (
      clinic_id, patient_id, appointment_id, type, category,
      amount, description, payment_method, status, date, protocol_ids
    ) VALUES (
      v_apt.clinic_id, v_apt.patient_id, p_appointment_id, 'receita', 'Consulta',
      p_value, COALESCE(NULLIF(p_description, ''), 'Consulta realizada'),
      v_final_method,
      CASE WHEN p_payment_status IN ('pago', 'pendente') THEN p_payment_status ELSE 'pago' END,
      v_apt.date, p_protocol_ids
    ) RETURNING id INTO v_tx_id;
  END IF;

  SELECT id INTO v_lead_id FROM leads WHERE converted_patient_id = v_apt.patient_id LIMIT 1;
  IF v_lead_id IS NULL AND v_apt.patient_phone IS NOT NULL THEN
    SELECT id INTO v_lead_id FROM leads
    WHERE clinic_id = v_apt.clinic_id AND normalize_br_phone(phone) = normalize_br_phone(v_apt.patient_phone)
    ORDER BY created_at DESC LIMIT 1;
    IF v_lead_id IS NOT NULL THEN
      UPDATE leads SET converted_patient_id = v_apt.patient_id WHERE id = v_lead_id;
    END IF;
  END IF;

  IF v_lead_id IS NOT NULL AND p_value > 0 THEN
    INSERT INTO conversions (
      clinic_id, lead_id, value, description, payment_method,
      protocol_ids, converted_at, financial_transaction_id
    ) VALUES (
      v_apt.clinic_id, v_lead_id, p_value,
      COALESCE(NULLIF(p_description, ''), 'Consulta realizada'),
      v_final_method, p_protocol_ids,
      (v_apt.date::text || ' ' || COALESCE(v_apt.time::text, '00:00:00'))::timestamptz,
      v_tx_id
    )
    ON CONFLICT (lead_id, financial_transaction_id) WHERE financial_transaction_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_conv_id;
  END IF;

  IF p_ticket_id IS NOT NULL THEN
    SELECT id INTO v_ganho_stage_id FROM funnel_stages WHERE clinic_id = v_apt.clinic_id AND slug = 'ganho' LIMIT 1;
    IF v_ganho_stage_id IS NOT NULL THEN
      UPDATE tickets SET stage_id = v_ganho_stage_id, outcome = 'ganho', outcome_at = now() WHERE id = p_ticket_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'appointment_id', p_appointment_id, 'transaction_id', v_tx_id, 'conversion_id', v_conv_id, 'lead_id', v_lead_id);
END; $function$;
