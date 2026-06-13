-- Ajuste do auto-resolve (decisao do usuario 13/06): SO auto-resolve jornada que JA FOI
-- GANHA (tickets.outcome='ganho', ou seja, valores ja lancados via finalize_appointment ou
-- GanhoModal). Jornadas com consulta COMPARECEU sem finalizar ou ATRASADA sem desfecho
-- voltam a BLOQUEAR o reagendamento: a secretaria precisa lancar os valores primeiro
-- (substitui a regra da migration 20260613000010).
--
-- E o bloqueio de book_appointment agora devolve CONTEXTO RICO para a IA/front decidir:
--   error_code='ticket_has_active_appointment'
--   existing_appointment = { appointment_id, date, time, status, doctor_name, modality }
--   reason = 'upcoming_appointment' (consulta marcada hoje/futura)
--          | 'awaiting_finalization' (compareceu/atrasada aguardando desfecho da secretaria)

CREATE OR REPLACE FUNCTION public.fn_resolve_patient_lead_ticket(
  p_clinic_id uuid, p_patient_id uuid, p_lead_id uuid, p_name text, p_phone text,
  OUT o_patient_id uuid, OUT o_lead_id uuid, OUT o_ticket_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_nphone text; v_lead_name text; v_lead_phone text; v_lead_converted uuid; v_name text; v_phone text; v_stage_id uuid;
BEGIN
  v_nphone := normalize_br_phone(p_phone);
  IF p_lead_id IS NOT NULL THEN
    SELECT id, name, phone, converted_patient_id INTO o_lead_id, v_lead_name, v_lead_phone, v_lead_converted
    FROM leads WHERE id=p_lead_id AND clinic_id=p_clinic_id;
  END IF;
  o_patient_id := p_patient_id;
  IF o_patient_id IS NULL AND o_lead_id IS NOT NULL THEN o_patient_id := v_lead_converted; END IF;
  IF o_patient_id IS NULL AND v_nphone IS NOT NULL THEN
    SELECT id INTO o_patient_id FROM patients WHERE clinic_id=p_clinic_id AND normalize_br_phone(phone)=v_nphone LIMIT 1;
  END IF;
  IF o_patient_id IS NULL THEN
    v_name := COALESCE(NULLIF(p_name,''), v_lead_name, 'Paciente');
    v_phone := COALESCE(NULLIF(p_phone,''), v_lead_phone);
    INSERT INTO patients (clinic_id, name, phone) VALUES (p_clinic_id, v_name, v_phone) RETURNING id INTO o_patient_id;
  END IF;
  IF v_nphone IS NULL THEN SELECT normalize_br_phone(phone) INTO v_nphone FROM patients WHERE id=o_patient_id; END IF;
  IF o_lead_id IS NULL AND v_nphone IS NOT NULL THEN
    SELECT id INTO o_lead_id FROM leads WHERE clinic_id=p_clinic_id AND normalize_br_phone(phone)=v_nphone ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF o_lead_id IS NULL THEN
    IF v_nphone IS NOT NULL THEN
      SELECT name, phone INTO v_name, v_phone FROM patients WHERE id=o_patient_id;
      INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, converted_patient_id)
      VALUES (p_clinic_id, COALESCE(v_name,'Paciente'), v_phone, 'manual','manual', false, o_patient_id) RETURNING id INTO o_lead_id;
    END IF;
  ELSE
    UPDATE leads SET converted_patient_id=COALESCE(converted_patient_id, o_patient_id) WHERE id=o_lead_id;
  END IF;
  IF o_lead_id IS NOT NULL THEN
    SELECT id INTO o_ticket_id FROM tickets WHERE lead_id=o_lead_id AND status='open' ORDER BY opened_at DESC LIMIT 1;

    -- AUTO-RESOLVE restrito: so fecha a jornada se ela JA FOI GANHA (valores lancados)
    -- e nao ha consulta marcada. Compareceu/atrasada SEM desfecho NAO auto-resolve.
    IF o_ticket_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM tickets t WHERE t.id=o_ticket_id AND t.outcome='ganho')
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.ticket_id=o_ticket_id AND a.status IN ('pendente','confirmado')) THEN
      UPDATE tickets SET status='closed', closed_at=now() WHERE id=o_ticket_id;
      o_ticket_id := NULL;
    END IF;

    IF o_ticket_id IS NULL THEN
      SELECT id INTO v_stage_id FROM funnel_stages WHERE clinic_id=p_clinic_id AND slug='agendado' LIMIT 1;
      IF v_stage_id IS NOT NULL THEN
        INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
        VALUES (p_clinic_id, o_lead_id, v_stage_id, 'open', now()) RETURNING id INTO o_ticket_id;
      END IF;
    END IF;
  END IF;
END; $f$;

-- book_appointment com contexto rico no bloqueio (corpo identico ao da 0004 exceto o handler)
DROP FUNCTION IF EXISTS public.book_appointment(uuid, uuid, date, time without time zone, text, text, integer, text, text, text, uuid, uuid, uuid, uuid, boolean, boolean);
CREATE FUNCTION public.book_appointment(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_patient_name text, p_patient_phone text, p_duration_minutes integer DEFAULT NULL,
  p_source text DEFAULT 'manual', p_modality text DEFAULT 'presencial', p_notes text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL, p_consultation_type_id uuid DEFAULT NULL,
  p_patient_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL,
  p_ignore_min_notice boolean DEFAULT NULL, p_validate_availability boolean DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_existing_request RECORD; v_doctor RECORD; v_ct RECORD; v_type_slug text;
  v_final_modality text; v_duration int; v_nphone text; v_validate boolean; v_ignore_min boolean;
  v_patient_id uuid; v_lead_id uuid; v_ticket_id uuid; v_apt_id uuid; v_constraint text;
  v_existing jsonb;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT br.appointment_id INTO v_existing_request FROM booking_requests br WHERE br.request_id=p_request_id LIMIT 1;
    IF FOUND THEN RETURN jsonb_build_object('success',true,'idempotent',true,'appointment_id',v_existing_request.appointment_id); END IF;
  END IF;
  IF p_lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads WHERE id=p_lead_id AND clinic_id=p_clinic_id) THEN
    RETURN jsonb_build_object('success',false,'error_code','lead_not_found'); END IF;
  IF p_patient_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM patients WHERE id=p_patient_id AND clinic_id=p_clinic_id) THEN
    RETURN jsonb_build_object('success',false,'error_code','patient_not_found'); END IF;
  SELECT id, clinic_id, COALESCE(consultation_duration,60) AS duration, is_active INTO v_doctor FROM doctors WHERE id=p_doctor_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error_code','doctor_not_found'); END IF;
  IF v_doctor.clinic_id<>p_clinic_id THEN RETURN jsonb_build_object('success',false,'error_code','doctor_clinic_mismatch'); END IF;
  IF v_doctor.is_active=false THEN RETURN jsonb_build_object('success',false,'error_code','doctor_inactive'); END IF;
  IF p_consultation_type_id IS NOT NULL THEN
    SELECT * INTO v_ct FROM consultation_types WHERE id=p_consultation_type_id AND doctor_id=p_doctor_id;
  ELSE
    v_type_slug := COALESCE(p_modality,'presencial');
    SELECT * INTO v_ct FROM consultation_types WHERE doctor_id=p_doctor_id AND slug=v_type_slug;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error_code','consultation_type_not_found'); END IF;
  IF v_ct.is_active=false THEN RETURN jsonb_build_object('success',false,'error_code','consultation_type_inactive'); END IF;
  v_type_slug := v_ct.slug; v_final_modality := v_ct.modality;
  v_duration := COALESCE(p_duration_minutes, v_ct.consultation_duration, v_doctor.duration);
  IF p_patient_id IS NULL AND p_lead_id IS NULL THEN
    v_nphone := normalize_br_phone(p_patient_phone);
    IF v_nphone IS NULL OR length(v_nphone)<12 THEN RETURN jsonb_build_object('success',false,'error_code','invalid_phone'); END IF;
  END IF;
  v_validate := COALESCE(p_validate_availability, (p_source='ia'));
  v_ignore_min := COALESCE(p_ignore_min_notice, (p_source<>'ia'));
  IF v_validate THEN
    IF NOT EXISTS (SELECT 1 FROM get_available_slots(p_doctor_id, p_date, v_ct.id, NULL::uuid, v_ignore_min) s WHERE s.slot_time::time=p_time) THEN
      RETURN jsonb_build_object('success',false,'error_code','slot_unavailable');
    END IF;
  END IF;
  BEGIN
    SELECT o_patient_id, o_lead_id, o_ticket_id INTO v_patient_id, v_lead_id, v_ticket_id
    FROM fn_resolve_patient_lead_ticket(p_clinic_id, p_patient_id, p_lead_id, p_patient_name, p_patient_phone);
    INSERT INTO appointments (clinic_id, patient_id, doctor_id, date, time, duration_minutes, status, source,
      modality, consultation_type_slug, consultation_type_id, notes, ticket_id)
    VALUES (p_clinic_id, v_patient_id, p_doctor_id, p_date, p_time, v_duration, 'pendente', p_source,
      v_final_modality, v_type_slug, v_ct.id, p_notes, v_ticket_id) RETURNING id INTO v_apt_id;
  EXCEPTION
    WHEN exclusion_violation THEN RETURN jsonb_build_object('success',false,'error_code','slot_conflict');
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'appointments_one_active_per_ticket' THEN
        SELECT jsonb_build_object(
          'appointment_id', a.id, 'date', a.date, 'time', to_char(a.time,'HH24:MI'),
          'status', a.status, 'doctor_name', d.name, 'modality', a.modality
        ) INTO v_existing
        FROM appointments a LEFT JOIN doctors d ON d.id=a.doctor_id
        WHERE a.ticket_id=v_ticket_id AND a.status NOT IN ('cancelado','faltou')
        ORDER BY a.date DESC LIMIT 1;
        RETURN jsonb_build_object('success',false,'error_code','ticket_has_active_appointment',
          'existing_appointment', v_existing,
          'reason', CASE WHEN (v_existing->>'status') IN ('pendente','confirmado') AND (v_existing->>'date')::date >= current_date
                         THEN 'upcoming_appointment' ELSE 'awaiting_finalization' END);
      END IF;
      RAISE;
  END;
  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id) VALUES (p_request_id, v_apt_id, p_clinic_id) ON CONFLICT (request_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('success',true,'appointment_id',v_apt_id,'patient_id',v_patient_id,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'consultation_type_id',v_ct.id);
END; $f$;
