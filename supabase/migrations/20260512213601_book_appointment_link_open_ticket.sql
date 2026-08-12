-- 20260512213601_book_appointment_link_open_ticket
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.book_appointment(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_patient_name text, p_patient_phone text,
  p_duration_minutes integer DEFAULT NULL::integer,
  p_source text DEFAULT 'manual'::text,
  p_modality text DEFAULT 'presencial'::text,
  p_notes text DEFAULT NULL::text,
  p_request_id uuid DEFAULT NULL::uuid
)
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
BEGIN
  -- 1. Idempotência
  IF p_request_id IS NOT NULL THEN
    SELECT br.appointment_id, a.*
      INTO v_existing_request
    FROM booking_requests br
    JOIN appointments a ON a.id = br.appointment_id
    WHERE br.request_id = p_request_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'appointment_id', v_existing_request.appointment_id);
    END IF;
  END IF;

  -- 2. Valida médico
  SELECT id, clinic_id, COALESCE(consultation_duration, 60) AS duration, is_active
    INTO v_doctor
  FROM doctors
  WHERE id = p_doctor_id;
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

  -- 3. Resolve paciente
  SELECT id INTO v_patient_id
  FROM patients
  WHERE clinic_id = p_clinic_id AND phone = p_patient_phone
  LIMIT 1;
  IF v_patient_id IS NULL THEN
    INSERT INTO patients (clinic_id, name, phone)
    VALUES (p_clinic_id, p_patient_name, p_patient_phone)
    RETURNING id INTO v_patient_id;
  END IF;

  -- 4. NOVO: busca ticket aberto do lead com mesmo phone (pra linkar o appointment)
  SELECT t.id INTO v_ticket_id
  FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE l.clinic_id = p_clinic_id
    AND l.phone = p_patient_phone
    AND t.status = 'open'
  ORDER BY t.opened_at DESC
  LIMIT 1;

  -- 5. Insere o appointment (com ticket_id se houver ticket aberto)
  BEGIN
    INSERT INTO appointments (
      clinic_id, patient_id, doctor_id, date, time,
      duration_minutes, status, source, modality, notes, ticket_id
    ) VALUES (
      p_clinic_id, v_patient_id, p_doctor_id, p_date, p_time,
      v_duration, 'pendente', p_source, p_modality, p_notes, v_ticket_id
    )
    RETURNING * INTO v_appointment;
    v_appointment_id := v_appointment.id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'slot_conflict');
  END;

  -- 6. Idempotência registro
  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id)
    VALUES (p_request_id, v_appointment_id, p_clinic_id)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  -- 7. Atualiza lead com converted_patient_id
  UPDATE leads
  SET converted_patient_id = v_patient_id
  WHERE clinic_id = p_clinic_id
    AND phone = p_patient_phone
    AND converted_patient_id IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'patient_id', v_patient_id,
    'ticket_id', v_ticket_id
  );
END;
$function$;
