-- Blinda book_appointment contra telefone ausente/inválido.
--
-- Contexto: a tool de agendamento da IA (n8n MARCAR_HORARIO1) preenchia patient_phone
-- via $fromAI (valor decidido pelo modelo), que podia chegar vazio ou inválido. A RPC
-- fazia v_phone := normalize_br_phone(p_patient_phone) (que vira NULL/'' p/ lixo) e mesmo
-- assim criava paciente (phone NULL via tr_sanitize_patient_phone) e appointment com
-- ticket_id NULL, sem setar leads.converted_patient_id. Resultado: agendamento ÓRFÃO ->
-- o card nunca ia p/ "Agendado" -> o follow-up de reengajamento disparava p/ quem já
-- estava agendado.
--
-- Correção: rejeitar com error_code 'invalid_phone' quando o telefone normalizado não
-- for um número BR válido. Forma canônica = 12 dígitos (55 + DDD + 8); como o vínculo
-- lead/ticket é normalize_br_phone(l.phone) = v_phone, nada com < 12 dígitos consegue
-- casar com um lead real, então seria órfão de qualquer modo.

CREATE OR REPLACE FUNCTION public.book_appointment(p_clinic_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone, p_patient_name text, p_patient_phone text, p_duration_minutes integer DEFAULT NULL::integer, p_source text DEFAULT 'manual'::text, p_modality text DEFAULT 'presencial'::text, p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid, p_consultation_type_id uuid DEFAULT NULL::uuid)
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

  -- Guarda de telefone: ausente/inválido nunca deve criar agendamento órfão.
  -- Número BR canônico normalizado = 12 dígitos (55 + DDD + 8).
  v_phone := normalize_br_phone(p_patient_phone);
  IF v_phone IS NULL OR length(v_phone) < 12 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_phone');
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
