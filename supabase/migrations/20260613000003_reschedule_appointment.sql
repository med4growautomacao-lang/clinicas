-- Reagendamento validado: a edicao de data/hora/medico no app passa a usar esta RPC
-- em vez de UPDATE cru. Revalida o slot (exceto encaixe forcado) e recalcula a duracao
-- (o trigger fn_appointment_inherit_doctor_duration so roda em INSERT, entao no UPDATE a
-- duracao/slot_range ficaria desatualizada se mudasse medico/tipo).

CREATE OR REPLACE FUNCTION public.reschedule_appointment(
  p_appointment_id       uuid,
  p_doctor_id            uuid,
  p_date                 date,
  p_time                 time without time zone,
  p_consultation_type_id uuid    DEFAULT NULL,
  p_modality             text    DEFAULT NULL,
  p_force                boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_apt    RECORD;
  v_doctor RECORD;
  v_ct     RECORD;
  v_type_slug text;
  v_duration int;
  v_final_modality text;
BEGIN
  SELECT * INTO v_apt FROM appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'appointment_not_found'); END IF;
  IF v_apt.status IN ('cancelado','realizado','compareceu','faltou') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'appointment_not_reschedulable');
  END IF;

  SELECT id, clinic_id, COALESCE(consultation_duration, 60) AS duration, is_active
    INTO v_doctor FROM doctors WHERE id = p_doctor_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_not_found'); END IF;
  IF v_doctor.clinic_id <> v_apt.clinic_id THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_clinic_mismatch'); END IF;
  IF v_doctor.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'doctor_inactive'); END IF;

  IF p_consultation_type_id IS NOT NULL THEN
    SELECT * INTO v_ct FROM consultation_types WHERE id = p_consultation_type_id AND doctor_id = p_doctor_id;
  ELSE
    v_type_slug := COALESCE(p_modality, v_apt.consultation_type_slug, v_apt.modality, 'presencial');
    SELECT * INTO v_ct FROM consultation_types WHERE doctor_id = p_doctor_id AND slug = v_type_slug;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_not_found'); END IF;
  IF v_ct.is_active = false THEN RETURN jsonb_build_object('success', false, 'error_code', 'consultation_type_inactive'); END IF;

  v_type_slug := v_ct.slug;
  v_final_modality := v_ct.modality;
  v_duration := COALESCE(v_ct.consultation_duration, v_doctor.duration);

  -- Revalida slot (exclui o proprio agendamento). p_force = encaixe da recepcao.
  IF NOT p_force THEN
    IF NOT EXISTS (
      SELECT 1 FROM get_available_slots(p_doctor_id, p_date, v_ct.id, p_appointment_id, true) s
      WHERE s.slot_time::time = p_time
    ) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'slot_unavailable');
    END IF;
  END IF;

  BEGIN
    UPDATE appointments SET
      doctor_id              = p_doctor_id,
      date                   = p_date,
      time                   = p_time,
      duration_minutes       = v_duration,
      consultation_type_id   = v_ct.id,
      consultation_type_slug = v_type_slug,
      modality               = v_final_modality
    WHERE id = p_appointment_id;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'slot_conflict');
  END;

  RETURN jsonb_build_object('success', true, 'appointment_id', p_appointment_id);
END;
$function$;
