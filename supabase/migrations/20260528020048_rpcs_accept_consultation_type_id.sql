-- 20260528020048_rpcs_accept_consultation_type_id
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1) get_available_slots sobrecarga: aceita consultation_type_id direto
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_consultation_type_id uuid,
  p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS TABLE(slot_time time without time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_slug text;
BEGIN
  SELECT slug INTO v_slug FROM consultation_types WHERE id = p_consultation_type_id AND doctor_id = p_doctor_id;
  IF v_slug IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.get_available_slots(p_doctor_id, p_date, v_slug, p_exclude_appointment_id);
END;
$$;

-- 2) book_appointment: aceita p_consultation_type_id; fallback no slug (p_modality)
CREATE OR REPLACE FUNCTION public.book_appointment(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_patient_name text, p_patient_phone text,
  p_duration_minutes integer DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_modality text DEFAULT 'presencial',
  p_notes text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_consultation_type_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_existing_request RECORD;
  v_doctor RECORD;
  v_duration int;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_appointment RECORD;
  v_ticket_id uuid;
  v_ct RECORD;
  v_type_slug text;
  v_final_modality text;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT br.appointment_id INTO v_existing_request FROM booking_requests br
    WHERE br.request_id = p_request_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'appointment_id', v_existing_request.appointment_id);
    END IF;
  END IF;

  SELECT id, clinic_id, COALESCE(consultation_duration, 60) AS duration, is_active
    INTO v_doctor FROM doctors WHERE id = p_doctor_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_not_found'); END IF;
  IF v_doctor.clinic_id <> p_clinic_id THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_clinic_mismatch'); END IF;
  IF v_doctor.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_inactive'); END IF;

  -- Resolver consultation_type: prioridade pro id, fallback no slug (p_modality)
  IF p_consultation_type_id IS NOT NULL THEN
    SELECT * INTO v_ct FROM consultation_types
    WHERE id = p_consultation_type_id AND doctor_id = p_doctor_id;
  ELSE
    v_type_slug := COALESCE(p_modality, 'presencial');
    SELECT * INTO v_ct FROM consultation_types
    WHERE doctor_id = p_doctor_id AND slug = v_type_slug;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_not_found'); END IF;
  IF v_ct.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_inactive'); END IF;

  v_type_slug := v_ct.slug;
  v_final_modality := v_ct.modality;
  v_duration := COALESCE(p_duration_minutes, v_ct.consultation_duration, v_doctor.duration);

  SELECT id INTO v_patient_id FROM patients
  WHERE clinic_id = p_clinic_id AND phone = p_patient_phone LIMIT 1;
  IF v_patient_id IS NULL THEN
    INSERT INTO patients (clinic_id, name, phone)
    VALUES (p_clinic_id, p_patient_name, p_patient_phone)
    RETURNING id INTO v_patient_id;
  END IF;

  SELECT t.id INTO v_ticket_id
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE l.clinic_id = p_clinic_id AND l.phone = p_patient_phone AND t.status = 'open'
  ORDER BY t.opened_at DESC LIMIT 1;

  BEGIN
    INSERT INTO appointments (
      clinic_id, patient_id, doctor_id, date, time,
      duration_minutes, status, source,
      modality, consultation_type_slug, consultation_type_id,
      notes, ticket_id
    ) VALUES (
      p_clinic_id, v_patient_id, p_doctor_id, p_date, p_time,
      v_duration, 'pendente', p_source,
      v_final_modality, v_type_slug, v_ct.id,
      p_notes, v_ticket_id
    )
    RETURNING * INTO v_appointment;
    v_appointment_id := v_appointment.id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'slot_conflict');
  END;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id)
    VALUES (p_request_id, v_appointment_id, p_clinic_id)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  UPDATE leads SET converted_patient_id = v_patient_id
  WHERE clinic_id = p_clinic_id AND phone = p_patient_phone AND converted_patient_id IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'patient_id', v_patient_id,
    'ticket_id', v_ticket_id,
    'consultation_type_id', v_ct.id
  );
END;
$$;

-- 3) convert_lead_to_appointment: idem
CREATE OR REPLACE FUNCTION public.convert_lead_to_appointment(
  p_clinic_id uuid, p_lead_id uuid, p_doctor_id uuid,
  p_date date, p_time time without time zone,
  p_modality text DEFAULT 'presencial',
  p_notes text DEFAULT NULL,
  p_ticket_id uuid DEFAULT NULL,
  p_duration_minutes integer DEFAULT NULL,
  p_request_id uuid DEFAULT NULL,
  p_consultation_type_id uuid DEFAULT NULL
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

  IF p_consultation_type_id IS NOT NULL THEN
    SELECT * INTO v_ct FROM consultation_types WHERE id = p_consultation_type_id AND doctor_id = p_doctor_id;
  ELSE
    v_type_slug := COALESCE(p_modality, 'presencial');
    SELECT * INTO v_ct FROM consultation_types WHERE doctor_id = p_doctor_id AND slug = v_type_slug;
  END IF;

  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_not_found'); END IF;
  IF v_ct.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_inactive'); END IF;

  v_type_slug := v_ct.slug;
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
      duration_minutes, status, source,
      modality, consultation_type_slug, consultation_type_id,
      notes, ticket_id
    ) VALUES (
      p_clinic_id, v_patient_id, p_doctor_id, p_date, p_time,
      v_duration, 'pendente', 'manual',
      v_final_modality, v_type_slug, v_ct.id,
      p_notes, p_ticket_id
    ) RETURNING id INTO v_apt_id;
  EXCEPTION WHEN exclusion_violation THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'slot_conflict');
  END;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id)
    VALUES (p_request_id, v_apt_id, p_clinic_id)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object('success', true, 'appointment_id', v_apt_id, 'patient_id', v_patient_id, 'lead_id', p_lead_id, 'consultation_type_id', v_ct.id);
END;
$$;

-- 4) RPC pública pra IA listar tipos (também acessível via PostgREST)
CREATE OR REPLACE FUNCTION public.list_consultation_types(p_clinic_id uuid, p_doctor_id uuid DEFAULT NULL)
RETURNS TABLE(
  id uuid, doctor_id uuid, doctor_name text, slug text, name text,
  modality text, description text, consultation_duration int, is_active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT ct.id, ct.doctor_id, d.name AS doctor_name, ct.slug, ct.name,
         ct.modality, ct.description, ct.consultation_duration, ct.is_active
  FROM consultation_types ct
  JOIN doctors d ON d.id = ct.doctor_id
  WHERE ct.clinic_id = p_clinic_id
    AND (p_doctor_id IS NULL OR ct.doctor_id = p_doctor_id)
    AND ct.is_active = true
  ORDER BY d.name, ct.name;
$$;
