-- 20260511181851_phase1_book_appointment_rpc
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- RPC 2: book_appointment
-- Booking atômico: resolve paciente, valida slot, insere, trata erros.
-- Suporta idempotência via request_id (mesmo request_id retorna mesmo appointment).
CREATE OR REPLACE FUNCTION public.book_appointment(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_date date,
  p_time time,
  p_patient_name text,
  p_patient_phone text,
  p_duration_minutes int DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_modality text DEFAULT 'presencial',
  p_notes text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_request RECORD;
  v_doctor RECORD;
  v_duration int;
  v_patient_id uuid;
  v_appointment_id uuid;
  v_appointment RECORD;
BEGIN
  -- 1. Idempotência: se request_id já existe, retorna o appointment original
  IF p_request_id IS NOT NULL THEN
    SELECT br.appointment_id, a.*
      INTO v_existing_request
    FROM booking_requests br
    JOIN appointments a ON a.id = br.appointment_id
    WHERE br.request_id = p_request_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'idempotent', true,
        'appointment_id', v_existing_request.appointment_id
      );
    END IF;
  END IF;

  -- 2. Valida médico e pega duração
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

  -- 3. Resolve paciente: existe com esse telefone na clínica? senão cria
  SELECT id INTO v_patient_id
  FROM patients
  WHERE clinic_id = p_clinic_id AND phone = p_patient_phone
  LIMIT 1;

  IF v_patient_id IS NULL THEN
    INSERT INTO patients (clinic_id, name, phone)
    VALUES (p_clinic_id, p_patient_name, p_patient_phone)
    RETURNING id INTO v_patient_id;
  END IF;

  -- 4. Insere o appointment. EXCLUDE constraint protege contra sobreposição.
  BEGIN
    INSERT INTO appointments (
      clinic_id, patient_id, doctor_id, date, time,
      duration_minutes, status, source, modality, notes
    ) VALUES (
      p_clinic_id, v_patient_id, p_doctor_id, p_date, p_time,
      v_duration, 'pendente', p_source, p_modality, p_notes
    )
    RETURNING * INTO v_appointment;

    v_appointment_id := v_appointment.id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'slot_conflict');
  END;

  -- 5. Registra request_id pra idempotência (se fornecido)
  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id)
    VALUES (p_request_id, v_appointment_id, p_clinic_id)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  -- 6. Atualiza lead se houver com mesmo telefone sem conversão
  UPDATE leads
  SET converted_patient_id = v_patient_id
  WHERE clinic_id = p_clinic_id
    AND phone = p_patient_phone
    AND converted_patient_id IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_appointment_id,
    'patient_id', v_patient_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.book_appointment(uuid, uuid, date, time, text, text, int, text, text, text, uuid)
  TO anon, authenticated, service_role;
