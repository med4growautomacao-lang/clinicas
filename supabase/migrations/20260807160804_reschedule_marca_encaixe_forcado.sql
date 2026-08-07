-- Marca, na propria transacao, que este reagendamento usou o encaixe forcado da recepcao
-- (p_force), para o rastro de fn_log_appointment_change conseguir separar "a recepcao encaixou
-- de proposito" de "o sistema validou e liberou". A REGRA NAO MUDA: e so um set_config local.
create or replace function public.reschedule_appointment(
  p_appointment_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_consultation_type_id uuid default null::uuid, p_modality text default null::text,
  p_force boolean default false, p_requester_phone text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE v_apt RECORD; v_doctor RECORD; v_ct RECORD; v_type_slug text; v_duration int; v_final_modality text;
BEGIN
  SELECT a.*, p.phone AS patient_phone INTO v_apt FROM appointments a LEFT JOIN patients p ON p.id=a.patient_id WHERE a.id=p_appointment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error_code','appointment_not_found'); END IF;
  IF p_requester_phone IS NOT NULL THEN
    IF v_apt.patient_phone IS NULL OR normalize_br_phone(v_apt.patient_phone) IS DISTINCT FROM normalize_br_phone(p_requester_phone) THEN
      RETURN jsonb_build_object('success',false,'error_code','not_your_appointment');
    END IF;
  END IF;
  IF v_apt.status IN ('cancelado','realizado','compareceu','faltou') THEN RETURN jsonb_build_object('success',false,'error_code','appointment_not_reschedulable'); END IF;
  SELECT id, clinic_id, COALESCE(consultation_duration,60) AS duration, is_active INTO v_doctor FROM doctors WHERE id=p_doctor_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error_code','doctor_not_found'); END IF;
  IF v_doctor.clinic_id<>v_apt.clinic_id THEN RETURN jsonb_build_object('success',false,'error_code','doctor_clinic_mismatch'); END IF;
  IF v_doctor.is_active=false THEN RETURN jsonb_build_object('success',false,'error_code','doctor_inactive'); END IF;
  IF p_consultation_type_id IS NOT NULL THEN
    SELECT * INTO v_ct FROM consultation_types WHERE id=p_consultation_type_id AND doctor_id=p_doctor_id;
  ELSE
    v_type_slug := COALESCE(p_modality, v_apt.consultation_type_slug, v_apt.modality, 'presencial');
    SELECT * INTO v_ct FROM consultation_types WHERE doctor_id=p_doctor_id AND slug=v_type_slug;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error_code','consultation_type_not_found'); END IF;
  IF v_ct.is_active=false THEN RETURN jsonb_build_object('success',false,'error_code','consultation_type_inactive'); END IF;
  v_type_slug := v_ct.slug; v_final_modality := v_ct.modality; v_duration := COALESCE(v_ct.consultation_duration, v_doctor.duration);
  PERFORM pg_advisory_xact_lock(hashtext(p_doctor_id::text || '|' || p_date::text));
  IF NOT p_force THEN
    IF NOT EXISTS (SELECT 1 FROM get_available_slots(p_doctor_id, p_date, v_ct.id, p_appointment_id, (p_requester_phone IS NULL)) s WHERE s.slot_time::time=p_time) THEN
      RETURN jsonb_build_object('success',false,'error_code','slot_unavailable');
    END IF;
  END IF;
  -- Marca local (so nesta transacao) para o rastro saber que foi encaixe forcado.
  PERFORM set_config('app.appt_force', CASE WHEN p_force THEN '1' ELSE '0' END, true);
  BEGIN
    UPDATE appointments SET doctor_id=p_doctor_id, date=p_date, time=p_time, duration_minutes=v_duration,
      consultation_type_id=v_ct.id, consultation_type_slug=v_type_slug, modality=v_final_modality WHERE id=p_appointment_id;
  EXCEPTION WHEN exclusion_violation THEN RETURN jsonb_build_object('success',false,'error_code','slot_conflict'); END;
  RETURN jsonb_build_object('success',true,'appointment_id',p_appointment_id,'date',p_date,'time',to_char(p_time,'HH24:MI'),'doctor_name',(SELECT name FROM doctors WHERE id=p_doctor_id));
END; $function$;
