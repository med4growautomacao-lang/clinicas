-- Consolidacao do agendamento: uma RPC canonica (book_appointment) usada por TODOS os
-- caminhos (app manual, Kanban, IA), com a identidade (paciente+lead+ticket) resolvida
-- num unico helper. convert_lead_to_appointment vira wrapper fino.
--
-- Motivacao: hoje existem 3 caminhos de criacao divergentes (book_appointment / IA,
-- convert_lead_to_appointment / Kanban, INSERT cru / app manual). Todos os bugs de 12/06
-- (orfaos, tickets sem lead, leads duplicados por telefone) nasceram nessas costuras.
--
-- Fundacoes preservadas: slot_range gerado + exclusion constraint (double-booking),
-- get_available_slots (slot logic), triggers de vinculo (rede de seguranca), booking_requests.

-- ============================================================================
-- 1) Helper de identidade: resolve paciente + lead + ticket num so lugar.
--    Sempre casa telefone por normalize_br_phone (nunca igualdade exata).
--    Reusa o ticket ABERTO do lead (nunca abre um 2o) -> respeita o indice unico.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_resolve_patient_lead_ticket(
  p_clinic_id  uuid,
  p_patient_id uuid,
  p_lead_id    uuid,
  p_name       text,
  p_phone      text,
  OUT o_patient_id uuid,
  OUT o_lead_id    uuid,
  OUT o_ticket_id  uuid
)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nphone         text;
  v_lead_name      text;
  v_lead_phone     text;
  v_lead_converted uuid;
  v_name           text;
  v_phone          text;
  v_stage_id       uuid;
BEGIN
  v_nphone := normalize_br_phone(p_phone);

  -- Lead explicito (escalares, nao RECORD: evita "record nao atribuido" quando p_lead_id e NULL)
  IF p_lead_id IS NOT NULL THEN
    SELECT id, name, phone, converted_patient_id
      INTO o_lead_id, v_lead_name, v_lead_phone, v_lead_converted
    FROM leads WHERE id = p_lead_id AND clinic_id = p_clinic_id;
  END IF;

  -- Paciente: p_patient_id > lead.converted_patient_id > match por telefone normalizado > cria
  o_patient_id := p_patient_id;
  IF o_patient_id IS NULL AND o_lead_id IS NOT NULL THEN
    o_patient_id := v_lead_converted;
  END IF;
  IF o_patient_id IS NULL AND v_nphone IS NOT NULL THEN
    SELECT id INTO o_patient_id FROM patients
    WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone
    LIMIT 1;
  END IF;
  IF o_patient_id IS NULL THEN
    v_name  := COALESCE(NULLIF(p_name,''), v_lead_name, 'Paciente');
    v_phone := COALESCE(NULLIF(p_phone,''), v_lead_phone);
    INSERT INTO patients (clinic_id, name, phone)
    VALUES (p_clinic_id, v_name, v_phone)
    RETURNING id INTO o_patient_id;
  END IF;

  -- Se o telefone nao veio, puxa do paciente (para casar/criar lead)
  IF v_nphone IS NULL THEN
    SELECT normalize_br_phone(phone) INTO v_nphone FROM patients WHERE id = o_patient_id;
  END IF;

  -- Lead: explicito > match por telefone normalizado > cria (so com telefone valido)
  IF o_lead_id IS NULL AND v_nphone IS NOT NULL THEN
    SELECT id INTO o_lead_id FROM leads
    WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  IF o_lead_id IS NULL THEN
    IF v_nphone IS NOT NULL THEN
      SELECT name, phone INTO v_name, v_phone FROM patients WHERE id = o_patient_id;
      INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, converted_patient_id)
      VALUES (p_clinic_id, COALESCE(v_name,'Paciente'), v_phone, 'manual', 'manual', false, o_patient_id)
      RETURNING id INTO o_lead_id;
    END IF;
  ELSE
    UPDATE leads SET converted_patient_id = COALESCE(converted_patient_id, o_patient_id)
    WHERE id = o_lead_id;
  END IF;

  -- Ticket: reusa o aberto do lead; senao cria em 'agendado'. Nunca abre um 2o aberto.
  IF o_lead_id IS NOT NULL THEN
    SELECT id INTO o_ticket_id FROM tickets
    WHERE lead_id = o_lead_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;

    IF o_ticket_id IS NULL THEN
      SELECT id INTO v_stage_id FROM funnel_stages
      WHERE clinic_id = p_clinic_id AND slug = 'agendado' LIMIT 1;
      IF v_stage_id IS NOT NULL THEN
        INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
        VALUES (p_clinic_id, o_lead_id, v_stage_id, 'open', now())
        RETURNING id INTO o_ticket_id;
      END IF;
    END IF;
  END IF;
END;
$function$;

-- ============================================================================
-- 2) book_appointment canonica (superset). Aceita identidade por
--    patient_id (app) | lead_id (Kanban) | name+phone (IA).
--    DROP + CREATE porque a assinatura ganha params opcionais ao final.
-- ============================================================================
DROP FUNCTION IF EXISTS public.book_appointment(uuid, uuid, date, time without time zone, text, text, integer, text, text, text, uuid, uuid);

CREATE FUNCTION public.book_appointment(
  p_clinic_id            uuid,
  p_doctor_id            uuid,
  p_date                 date,
  p_time                 time without time zone,
  p_patient_name         text,
  p_patient_phone        text,
  p_duration_minutes     integer  DEFAULT NULL,
  p_source               text     DEFAULT 'manual',
  p_modality             text     DEFAULT 'presencial',
  p_notes                text     DEFAULT NULL,
  p_request_id           uuid     DEFAULT NULL,
  p_consultation_type_id uuid     DEFAULT NULL,
  -- novos (opcionais, ao final -> edge/Kanban por nome continuam compativeis)
  p_patient_id           uuid     DEFAULT NULL,
  p_lead_id              uuid     DEFAULT NULL,
  p_ignore_min_notice    boolean  DEFAULT NULL,
  p_validate_availability boolean DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_request RECORD;
  v_doctor       RECORD;
  v_ct           RECORD;
  v_type_slug    text;
  v_final_modality text;
  v_duration     int;
  v_nphone       text;
  v_validate     boolean;
  v_ignore_min   boolean;
  v_patient_id   uuid;
  v_lead_id      uuid;
  v_ticket_id    uuid;
  v_apt_id       uuid;
  v_constraint   text;
BEGIN
  -- Idempotencia
  IF p_request_id IS NOT NULL THEN
    SELECT br.appointment_id INTO v_existing_request FROM booking_requests br
    WHERE br.request_id = p_request_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'appointment_id', v_existing_request.appointment_id);
    END IF;
  END IF;

  -- Medico
  SELECT id, clinic_id, COALESCE(consultation_duration, 60) AS duration, is_active
    INTO v_doctor FROM doctors WHERE id = p_doctor_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_not_found'); END IF;
  IF v_doctor.clinic_id <> p_clinic_id THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_clinic_mismatch'); END IF;
  IF v_doctor.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_inactive'); END IF;

  -- Tipo de consulta
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

  -- Guarda de telefone: so quando a identidade e puramente por telefone (caminho IA).
  IF p_patient_id IS NULL AND p_lead_id IS NULL THEN
    v_nphone := normalize_br_phone(p_patient_phone);
    IF v_nphone IS NULL OR length(v_nphone) < 12 THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'invalid_phone');
    END IF;
  END IF;

  -- Validacao de slot no servidor.
  -- Default: estrita para IA, lenient para manual/Kanban (recepcao precisa de encaixe).
  -- A FE pode forcar via p_validate_availability.
  v_validate   := COALESCE(p_validate_availability, (p_source = 'ia'));
  v_ignore_min := COALESCE(p_ignore_min_notice, (p_source <> 'ia'));
  IF v_validate THEN
    IF NOT EXISTS (
      SELECT 1 FROM get_available_slots(p_doctor_id, p_date, v_ct.id, NULL::uuid, v_ignore_min) s
      WHERE s.slot_time::time = p_time
    ) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'slot_unavailable');
    END IF;
  END IF;

  -- Identidade + insert no MESMO bloco (savepoint): se o slot conflitar, o paciente/lead/
  -- ticket criados pelo helper sao revertidos junto -> nunca deixa orfao por conflito.
  BEGIN
    SELECT o_patient_id, o_lead_id, o_ticket_id
      INTO v_patient_id, v_lead_id, v_ticket_id
    FROM fn_resolve_patient_lead_ticket(p_clinic_id, p_patient_id, p_lead_id, p_patient_name, p_patient_phone);

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
    ) RETURNING id INTO v_apt_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      -- doctor ja ocupado nesse horario (constraint de sobreposicao)
      RETURN jsonb_build_object('success', false, 'error_code', 'slot_conflict');
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'appointments_one_active_per_ticket' THEN
        -- o ticket/jornada do paciente ja tem um agendamento ativo
        RETURN jsonb_build_object('success', false, 'error_code', 'ticket_has_active_appointment');
      END IF;
      RAISE;
  END;

  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id)
    VALUES (p_request_id, v_apt_id, p_clinic_id)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', v_apt_id,
    'patient_id', v_patient_id,
    'lead_id', v_lead_id,
    'ticket_id', v_ticket_id,
    'consultation_type_id', v_ct.id
  );
END;
$function$;

-- ============================================================================
-- 3) convert_lead_to_appointment vira wrapper fino (Kanban nao muda a chamada).
--    p_ticket_id mantido na assinatura por compatibilidade (o helper resolve o
--    ticket aberto do lead, que e o mesmo).
-- ============================================================================
DROP FUNCTION IF EXISTS public.convert_lead_to_appointment(uuid, uuid, uuid, date, time without time zone, text, text, uuid, integer, uuid, uuid);

CREATE FUNCTION public.convert_lead_to_appointment(
  p_clinic_id            uuid,
  p_lead_id              uuid,
  p_doctor_id            uuid,
  p_date                 date,
  p_time                 time without time zone,
  p_modality             text     DEFAULT 'presencial',
  p_notes                text     DEFAULT NULL,
  p_ticket_id            uuid     DEFAULT NULL,
  p_duration_minutes     integer  DEFAULT NULL,
  p_request_id           uuid     DEFAULT NULL,
  p_consultation_type_id uuid     DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.book_appointment(
    p_clinic_id            => p_clinic_id,
    p_doctor_id            => p_doctor_id,
    p_date                 => p_date,
    p_time                 => p_time,
    p_patient_name         => NULL,
    p_patient_phone        => NULL,
    p_duration_minutes     => p_duration_minutes,
    p_source               => 'manual',
    p_modality             => p_modality,
    p_notes                => p_notes,
    p_request_id           => p_request_id,
    p_consultation_type_id => p_consultation_type_id,
    p_lead_id              => p_lead_id
  );
END;
$function$;
