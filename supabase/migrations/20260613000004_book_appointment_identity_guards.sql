-- Guardas de identidade explicita na book_appointment: se p_lead_id/p_patient_id forem
-- informados mas nao existirem (na clinica), retorna erro limpo (lead_not_found /
-- patient_not_found) em vez de criar paciente "orfao" ou estourar erro cru de FK.
-- Resto da funcao identico a 20260613000001.
CREATE OR REPLACE FUNCTION public.book_appointment(
  p_clinic_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_patient_name text, p_patient_phone text, p_duration_minutes integer DEFAULT NULL,
  p_source text DEFAULT 'manual', p_modality text DEFAULT 'presencial', p_notes text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL, p_consultation_type_id uuid DEFAULT NULL,
  p_patient_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL,
  p_ignore_min_notice boolean DEFAULT NULL, p_validate_availability boolean DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_existing_request RECORD; v_doctor RECORD; v_ct RECORD; v_type_slug text;
  v_final_modality text; v_duration int; v_nphone text; v_validate boolean; v_ignore_min boolean;
  v_patient_id uuid; v_lead_id uuid; v_ticket_id uuid; v_apt_id uuid; v_constraint text;
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
        RETURN jsonb_build_object('success',false,'error_code','ticket_has_active_appointment');
      END IF;
      RAISE;
  END;
  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id) VALUES (p_request_id, v_apt_id, p_clinic_id) ON CONFLICT (request_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('success',true,'appointment_id',v_apt_id,'patient_id',v_patient_id,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'consultation_type_id',v_ct.id);
END; $function$;
