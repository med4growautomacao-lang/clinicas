-- 20260528001655_convert_lead_to_appointment_uses_type_slug
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.convert_lead_to_appointment(
  p_clinic_id uuid, p_lead_id uuid, p_doctor_id uuid,
  p_date date, p_time time without time zone,
  p_modality text DEFAULT 'presencial',
  p_notes text DEFAULT NULL,
  p_ticket_id uuid DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_lead RECORD;
  v_doctor RECORD;
  v_patient_id uuid;
  v_duration int;
  v_apt_id uuid;
  v_existing_request RECORD;
  v_ct RECORD;
  v_type_slug text;
  v_final_modality text;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT appointment_id INTO v_existing_request FROM booking_requests WHERE request_id = p_request_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'appointment_id', v_existing_request.appointment_id);
    END IF;
  END IF;

  SELECT id, name, phone, email, clinic_id, converted_patient_id INTO v_lead FROM leads WHERE id = p_lead_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'lead_not_found'); END IF;
  IF v_lead.clinic_id <> p_clinic_id THEN RETURN jsonb_build_object('success', false, 'error_code', 'lead_clinic_mismatch'); END IF;

  SELECT id, clinic_id, COALESCE(consultation_duration, 60) AS duration, is_active
    INTO v_doctor FROM doctors WHERE id = p_doctor_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_not_found'); END IF;
  IF v_doctor.clinic_id <> p_clinic_id THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_clinic_mismatch'); END IF;
  IF v_doctor.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_inactive'); END IF;

  v_type_slug := COALESCE(p_modality, 'presencial');
  SELECT * INTO v_ct FROM consultation_types
  WHERE doctor_id = p_doctor_id AND slug = v_type_slug;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_not_found'); END IF;
  IF v_ct.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_inactive'); END IF;

  v_final_modality := v_ct.modality;
  v_duration := COALESCE(p_duration_minutes, v_ct.consultation_duration, v_doctor.duration);

  v_patient_id := v_lead.converted_patient_id;
  IF v_patient_id IS NULL AND v_lead.phone IS NOT NULL THEN
    SELECT id INTO v_patient_id FROM patients WHERE clinic_id = p_clinic_id AND phone = v_lead.phone LIMIT 1;
  END IF;
  IF v_patient_id IS NULL THEN
    INSERT INTO patients (clinic_id, name, phone, email)
    VALUES (p_clinic_id, v_lead.name, v_lead.phone, v_lead.email)
    RETURNING id INTO v_patient_id;
  END IF;

  IF v_lead.converted_patient_id IS NULL THEN
    UPDATE leads SET converted_patient_id = v_patient_id WHERE id = p_lead_id;
  END IF;

  BEGIN
    INSERT INTO appointments (
      clinic_id, patient_id, doctor_id, date, time,
      duration_minutes, status, source, modality, consultation_type_slug, notes, ticket_id
    ) VALUES (
      p_clinic_id, v_patient_id, p_doctor_id, p_date, p_time,
      v_duration, 'pendente', 'manual', v_final_modality, v_type_slug, p_notes, p_ticket_id
    ) RETURNING id INTO v_apt_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'slot_conflict');
  END;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id)
    VALUES (p_request_id, v_apt_id, p_clinic_id)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'appointment_id', v_apt_id, 'patient_id', v_patient_id, 'lead_id', p_lead_id);
END;
$$;
