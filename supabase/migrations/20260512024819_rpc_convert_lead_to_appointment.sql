-- 20260512024819_rpc_convert_lead_to_appointment
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Resolve lead → patient (UPSERT por telefone) → cria appointment atômico
CREATE OR REPLACE FUNCTION public.convert_lead_to_appointment(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_doctor_id uuid,
  p_date date,
  p_time time,
  p_modality text DEFAULT 'presencial',
  p_notes text DEFAULT NULL,
  p_ticket_id uuid DEFAULT NULL,
  p_duration_minutes int DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lead RECORD;
  v_doctor RECORD;
  v_patient_id uuid;
  v_duration int;
  v_apt_id uuid;
  v_existing_request RECORD;
BEGIN
  -- 1. Idempotência
  IF p_request_id IS NOT NULL THEN
    SELECT appointment_id INTO v_existing_request
    FROM booking_requests WHERE request_id = p_request_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'appointment_id', v_existing_request.appointment_id);
    END IF;
  END IF;

  -- 2. Busca lead
  SELECT id, name, phone, email, clinic_id, converted_patient_id
    INTO v_lead
  FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'lead_not_found');
  END IF;
  IF v_lead.clinic_id <> p_clinic_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'lead_clinic_mismatch');
  END IF;

  -- 3. Valida médico
  SELECT id, clinic_id, COALESCE(consultation_duration, 60) AS duration, is_active
    INTO v_doctor FROM doctors WHERE id = p_doctor_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'doctor_not_found');
  END IF;
  IF v_doctor.clinic_id <> p_clinic_id THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'doctor_clinic_mismatch');
  END IF;
  IF v_doctor.is_active = false THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'doctor_inactive');
  END IF;

  v_duration := COALESCE(p_duration_minutes, v_doctor.duration);

  -- 4. Resolve paciente (UPSERT por telefone na clínica)
  v_patient_id := v_lead.converted_patient_id;

  IF v_patient_id IS NULL AND v_lead.phone IS NOT NULL THEN
    SELECT id INTO v_patient_id
    FROM patients WHERE clinic_id = p_clinic_id AND phone = v_lead.phone LIMIT 1;
  END IF;

  IF v_patient_id IS NULL THEN
    INSERT INTO patients (clinic_id, name, phone, email)
    VALUES (p_clinic_id, v_lead.name, v_lead.phone, v_lead.email)
    RETURNING id INTO v_patient_id;
  END IF;

  -- 5. Vincula lead ao paciente (se ainda não estiver)
  IF v_lead.converted_patient_id IS NULL THEN
    UPDATE leads SET converted_patient_id = v_patient_id WHERE id = p_lead_id;
  END IF;

  -- 6. Cria appointment (EXCLUDE constraint protege contra sobreposição)
  BEGIN
    INSERT INTO appointments (
      clinic_id, patient_id, doctor_id, date, time,
      duration_minutes, status, source, modality, notes, ticket_id
    ) VALUES (
      p_clinic_id, v_patient_id, p_doctor_id, p_date, p_time,
      v_duration, 'pendente', 'manual',
      CASE WHEN p_modality IN ('presencial', 'online') THEN p_modality ELSE 'presencial' END,
      p_notes, p_ticket_id
    ) RETURNING id INTO v_apt_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'slot_conflict');
  END;

  -- 7. Idempotência (registra se request_id fornecido)
  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id)
    VALUES (p_request_id, v_apt_id, p_clinic_id)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_apt_id,
    'patient_id', v_patient_id,
    'lead_id', p_lead_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.convert_lead_to_appointment(uuid, uuid, uuid, date, time, text, text, uuid, int, uuid)
  TO anon, authenticated, service_role;
