-- Fix: book_appointment causava "duplicate key patients_clinic_phone_uniq".
-- Causa: a busca do paciente usava o telefone CRU (p_patient_phone), mas a tabela
-- guarda o telefone NORMALIZADO (trigger tr_sanitize_patient_phone -> normalize_br_phone).
-- Quando o n8n manda o telefone em formato diferente do salvo (ex.: JID do WhatsApp
-- 5535999433573 vs salvo 553599433573), a busca falha, o INSERT normaliza e colide no
-- índice único. Correção: comparar SEMPRE por normalize_br_phone(...) e usar ON CONFLICT.
-- As buscas de lead/ticket e o UPDATE de leads tinham o mesmo problema (corrigidos junto).

-- ── Versão 1 (sem p_consultation_type_id) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_appointment(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_patient_name text, p_patient_phone text,
  p_duration_minutes integer DEFAULT NULL::integer, p_source text DEFAULT 'manual'::text,
  p_modality text DEFAULT 'presencial'::text, p_notes text DEFAULT NULL::text,
  p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_request RECORD;
  v_doctor RECORD;
  v_duration int;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_appointment RECORD;
  v_ticket_id uuid;
  v_ct RECORD;
  v_final_modality text;
  v_type_slug text;
  v_phone text;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT br.appointment_id INTO v_existing_request
    FROM booking_requests br
    WHERE br.request_id = p_request_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'appointment_id', v_existing_request.appointment_id);
    END IF;
  END IF;

  SELECT id, clinic_id, COALESCE(consultation_duration, 60) AS duration, is_active
    INTO v_doctor
  FROM doctors WHERE id = p_doctor_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_not_found'); END IF;
  IF v_doctor.clinic_id <> p_clinic_id THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_clinic_mismatch'); END IF;
  IF v_doctor.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_inactive'); END IF;

  v_type_slug := COALESCE(p_modality, 'presencial');
  SELECT * INTO v_ct FROM consultation_types
  WHERE doctor_id = p_doctor_id AND slug = v_type_slug;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_not_found');
  END IF;
  IF v_ct.is_active = false THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_inactive');
  END IF;

  v_final_modality := v_ct.modality;
  v_duration := COALESCE(p_duration_minutes, v_ct.consultation_duration, v_doctor.duration);

  -- Telefone normalizado (mesma regra do trigger tr_sanitize_patient_phone)
  v_phone := normalize_br_phone(p_patient_phone);

  -- Busca o paciente por telefone NORMALIZADO (independe do formato recebido)
  SELECT id INTO v_patient_id FROM patients
  WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_phone
  LIMIT 1;
  IF v_patient_id IS NULL THEN
    INSERT INTO patients (clinic_id, name, phone)
    VALUES (p_clinic_id, p_patient_name, p_patient_phone)
    ON CONFLICT (clinic_id, phone) WHERE phone IS NOT NULL
      DO UPDATE SET name = COALESCE(patients.name, EXCLUDED.name)
    RETURNING id INTO v_patient_id;
  END IF;

  SELECT t.id INTO v_ticket_id
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE l.clinic_id = p_clinic_id AND normalize_br_phone(l.phone) = v_phone AND t.status = 'open'
  ORDER BY t.opened_at DESC LIMIT 1;

  BEGIN
    INSERT INTO appointments (
      clinic_id, patient_id, doctor_id, date, time,
      duration_minutes, status, source, modality, consultation_type_slug, notes, ticket_id
    ) VALUES (
      p_clinic_id, v_patient_id, p_doctor_id, p_date, p_time,
      v_duration, 'pendente', p_source, v_final_modality, v_type_slug, p_notes, v_ticket_id
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
  WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_phone AND converted_patient_id IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'patient_id', v_patient_id,
    'ticket_id', v_ticket_id
  );
END;
$function$;

-- ── Versão 2 (com p_consultation_type_id) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.book_appointment(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_patient_name text, p_patient_phone text,
  p_duration_minutes integer DEFAULT NULL::integer, p_source text DEFAULT 'manual'::text,
  p_modality text DEFAULT 'presencial'::text, p_notes text DEFAULT NULL::text,
  p_request_id uuid DEFAULT NULL::uuid, p_consultation_type_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_phone text;
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

  -- Telefone normalizado (mesma regra do trigger tr_sanitize_patient_phone)
  v_phone := normalize_br_phone(p_patient_phone);

  -- Busca o paciente por telefone NORMALIZADO (independe do formato recebido)
  SELECT id INTO v_patient_id FROM patients
  WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_phone
  LIMIT 1;
  IF v_patient_id IS NULL THEN
    INSERT INTO patients (clinic_id, name, phone)
    VALUES (p_clinic_id, p_patient_name, p_patient_phone)
    ON CONFLICT (clinic_id, phone) WHERE phone IS NOT NULL
      DO UPDATE SET name = COALESCE(patients.name, EXCLUDED.name)
    RETURNING id INTO v_patient_id;
  END IF;

  SELECT t.id INTO v_ticket_id
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE l.clinic_id = p_clinic_id AND normalize_br_phone(l.phone) = v_phone AND t.status = 'open'
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
  WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_phone AND converted_patient_id IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'patient_id', v_patient_id,
    'ticket_id', v_ticket_id,
    'consultation_type_id', v_ct.id
  );
END;
$function$;
