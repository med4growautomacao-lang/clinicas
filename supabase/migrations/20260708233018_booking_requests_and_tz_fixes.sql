-- 20260708233018_booking_requests_and_tz_fixes
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- book_appointment: idempotência checa status + reason em SP
CREATE OR REPLACE FUNCTION public.book_appointment(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_patient_name text, p_patient_phone text, p_duration_minutes integer DEFAULT NULL::integer,
  p_source text DEFAULT 'manual'::text, p_modality text DEFAULT 'presencial'::text,
  p_notes text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid,
  p_consultation_type_id uuid DEFAULT NULL::uuid, p_patient_id uuid DEFAULT NULL::uuid,
  p_lead_id uuid DEFAULT NULL::uuid, p_ignore_min_notice boolean DEFAULT NULL::boolean,
  p_validate_availability boolean DEFAULT NULL::boolean
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_existing_request RECORD; v_doctor RECORD; v_ct RECORD; v_type_slug text;
  v_final_modality text; v_duration int; v_nphone text; v_validate boolean; v_ignore_min boolean;
  v_patient_id uuid; v_lead_id uuid; v_ticket_id uuid; v_apt_id uuid; v_constraint text;
  v_existing jsonb;
BEGIN
  IF p_request_id IS NOT NULL THEN
    SELECT br.appointment_id INTO v_existing_request FROM booking_requests br WHERE br.request_id=p_request_id LIMIT 1;
    IF FOUND THEN
      IF EXISTS (SELECT 1 FROM appointments a WHERE a.id=v_existing_request.appointment_id AND a.status NOT IN ('cancelado','faltou')) THEN
        RETURN jsonb_build_object('success',true,'idempotent',true,'appointment_id',v_existing_request.appointment_id);
      ELSE
        DELETE FROM booking_requests WHERE request_id=p_request_id;
      END IF;
    END IF;
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
  PERFORM pg_advisory_xact_lock(hashtext(p_doctor_id::text || '|' || p_date::text));
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
          'reason', CASE WHEN (v_existing->>'status') IN ('pendente','confirmado') AND (v_existing->>'date')::date >= (now() AT TIME ZONE 'America/Sao_Paulo')::date
                         THEN 'upcoming_appointment' ELSE 'awaiting_finalization' END);
      END IF;
      RAISE;
  END;
  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id) VALUES (p_request_id, v_apt_id, p_clinic_id) ON CONFLICT (request_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('success',true,'appointment_id',v_apt_id,'patient_id',v_patient_id,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'consultation_type_id',v_ct.id);
END; $function$;

-- cancel_appointment: libera booking_requests do appointment cancelado
CREATE OR REPLACE FUNCTION public.cancel_appointment(
  p_appointment_id uuid, p_reason text DEFAULT NULL::text,
  p_revert_transaction boolean DEFAULT true, p_requester_phone text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_apt RECORD; v_reverted_tx_count int := 0;
BEGIN
  SELECT a.*, p.phone AS patient_phone INTO v_apt FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id WHERE a.id=p_appointment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'appointment_not_found'); END IF;
  IF p_requester_phone IS NOT NULL THEN
    IF v_apt.patient_phone IS NULL OR normalize_br_phone(v_apt.patient_phone) IS DISTINCT FROM normalize_br_phone(p_requester_phone) THEN
      RETURN jsonb_build_object('success',false,'error_code','not_your_appointment');
    END IF;
  END IF;
  IF v_apt.status = 'cancelado' THEN RETURN jsonb_build_object('success', true, 'idempotent', true); END IF;
  IF p_requester_phone IS NOT NULL AND v_apt.status NOT IN ('pendente','confirmado') THEN
    RETURN jsonb_build_object('success',false,'error_code','appointment_not_cancellable');
  END IF;
  UPDATE appointments SET status = 'cancelado',
    notes = COALESCE(notes || E'\n', '') || COALESCE('[Cancelado] ' || p_reason, '[Cancelado]')
  WHERE id = p_appointment_id;
  DELETE FROM booking_requests WHERE appointment_id = p_appointment_id;
  IF p_revert_transaction AND v_apt.status = 'realizado' THEN
    UPDATE financial_transactions SET status = 'cancelado',
      description = COALESCE(description, '') || ' [Consulta cancelada]'
    WHERE appointment_id = p_appointment_id AND status <> 'cancelado';
    GET DIAGNOSTICS v_reverted_tx_count = ROW_COUNT;
  END IF;
  RETURN jsonb_build_object('success', true, 'appointment_id', p_appointment_id,
    'previous_status', v_apt.status, 'reverted_transactions', v_reverted_tx_count);
END; $function$;

-- Backfill dos órfãos
DELETE FROM booking_requests br
USING appointments a
WHERE a.id = br.appointment_id AND a.status IN ('cancelado','faltou');

DELETE FROM booking_requests br
WHERE NOT EXISTS (SELECT 1 FROM appointments a WHERE a.id = br.appointment_id);
