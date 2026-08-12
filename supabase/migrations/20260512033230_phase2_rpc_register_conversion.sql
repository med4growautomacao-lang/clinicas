-- 20260512033230_phase2_rpc_register_conversion
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- RPC unificada: cria transaction + conversion atomicamente
CREATE OR REPLACE FUNCTION public.register_conversion(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_value numeric,
  p_payment_method text DEFAULT NULL,
  p_payment_status text DEFAULT 'pago',
  p_description text DEFAULT NULL,
  p_protocol_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_converted_at timestamptz DEFAULT now(),
  p_appointment_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead RECORD;
  v_patient_id uuid;
  v_tx_id uuid;
  v_conv_id uuid;
  v_final_method text;
  v_final_status text;
  v_existing_conv uuid;
BEGIN
  -- Valida lead
  SELECT id, clinic_id, converted_patient_id, phone, name, email
  INTO v_lead FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'lead_not_found');
  END IF;
  IF v_lead.clinic_id <> p_clinic_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'lead_clinic_mismatch');
  END IF;
  IF p_value <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_value');
  END IF;

  v_final_method := CASE WHEN p_payment_method IN ('pix','cartao','dinheiro','plano') THEN p_payment_method ELSE NULL END;
  v_final_status := CASE WHEN p_payment_status IN ('pago','pendente') THEN p_payment_status ELSE 'pago' END;

  -- Idempotência: já existe conversão pro lead nessa data com mesmo valor?
  SELECT id INTO v_existing_conv FROM conversions
  WHERE lead_id = p_lead_id
    AND value::numeric = p_value
    AND converted_at::date = p_converted_at::date
  LIMIT 1;
  IF v_existing_conv IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true, 'conversion_id', v_existing_conv);
  END IF;

  -- Resolve paciente (do lead)
  v_patient_id := v_lead.converted_patient_id;
  IF v_patient_id IS NULL AND v_lead.phone IS NOT NULL THEN
    SELECT id INTO v_patient_id FROM patients
    WHERE clinic_id = p_clinic_id AND phone = v_lead.phone LIMIT 1;
  END IF;
  IF v_patient_id IS NULL THEN
    INSERT INTO patients (clinic_id, name, phone, email)
    VALUES (p_clinic_id, v_lead.name, v_lead.phone, v_lead.email)
    RETURNING id INTO v_patient_id;
  END IF;
  IF v_lead.converted_patient_id IS NULL THEN
    UPDATE leads SET converted_patient_id = v_patient_id WHERE id = p_lead_id;
  END IF;

  -- Cria transaction
  INSERT INTO financial_transactions (
    clinic_id, patient_id, appointment_id, type, category,
    amount, description, payment_method, status, date, protocol_ids
  ) VALUES (
    p_clinic_id, v_patient_id, p_appointment_id, 'receita', 'Conversão',
    p_value, COALESCE(NULLIF(p_description, ''), 'Conversão de lead'),
    v_final_method, v_final_status, p_converted_at::date, p_protocol_ids
  ) RETURNING id INTO v_tx_id;

  -- Cria conversion linkada
  INSERT INTO conversions (
    clinic_id, lead_id, value, description, payment_method,
    protocol_ids, converted_at, financial_transaction_id
  ) VALUES (
    p_clinic_id, p_lead_id, p_value,
    COALESCE(NULLIF(p_description, ''), 'Conversão de lead'),
    v_final_method, p_protocol_ids, p_converted_at, v_tx_id
  ) RETURNING id INTO v_conv_id;

  RETURN jsonb_build_object(
    'success', true,
    'conversion_id', v_conv_id,
    'transaction_id', v_tx_id,
    'patient_id', v_patient_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_conversion(uuid, uuid, numeric, text, text, text, uuid[], timestamptz, uuid)
  TO anon, authenticated, service_role;
