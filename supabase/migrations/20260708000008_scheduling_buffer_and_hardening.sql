-- Correções no agendamento (auditoria 08/07):
--
-- (1) BUG DO BUFFER em get_available_slots (causa raiz do caso Bruna Fuzeta):
--     O check de conflito expandia o appointment EXISTENTE com os buffers do tipo
--     NOVO (trocando before/after de papel) e ignorava por completo os buffers do
--     tipo do appointment já existente. Resultado: consulta colada no fim de outra
--     sem respeitar buffer (ex.: Seguimento 17:30-18:15 + Primeira Online 18:15).
--     Correção: o gap exigido entre a candidata e cada appointment existente passa a
--     ser GREATEST(buffer do lado voltado de cada uma) — "o maior dos dois" (decisão
--     de produto 08/07), lendo os buffers do tipo de AMBAS as consultas.
--     Como book_appointment (source='ia') e reschedule_appointment revalidam via esta
--     mesma função, o fix conserta a listagem E a gravação de uma vez.
--
-- (2) reschedule_appointment ignorava min_notice SEMPRE (5º arg hardcoded = true).
--     Agora o caminho da IA/paciente (identificado por p_requester_phone) respeita a
--     antecedência mínima; o caminho da recepção (sem phone / p_force=true) segue livre.
--
-- (3) Corrida check-then-insert: a exclusion constraint só cobre overlap CRU do
--     slot_range (sem buffers). Advisory lock por (doctor_id, date) serializa reservas
--     concorrentes do mesmo médico/dia, fechando a janela de violação de buffer sob
--     bursts (n8n/IA + app).
--
-- (4) Segurança: as RPCs de escrita são SECURITY DEFINER (owner=postgres, bypassa RLS)
--     e tinham EXECUTE para anon/PUBLIC — chamáveis sem login com a chave publishable.
--     Revoga anon+PUBLIC; mantém authenticated (app) e service_role (IA/n8n).
--     NÃO fecha o vetor cross-tenant de um usuário AUTENTICADO passando UUIDs de outra
--     clínica — isso exige guardas has_clinic_access internas e teste contra o fluxo de
--     org members; fica para um passo separado.

-- ============================================================================
-- (1) get_available_slots — overload por slug (o overload uuid apenas delega)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_modality text DEFAULT 'presencial'::text,
  p_exclude_appointment_id uuid DEFAULT NULL::uuid,
  p_ignore_min_notice boolean DEFAULT false
)
 RETURNS TABLE(slot_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_duration int; v_step int;
  v_buffer_before int; v_buffer_after int; v_min_notice int;
  v_working jsonb; v_days_off jsonb; v_blocked jsonb;
  v_dow text; v_shift jsonb; v_blk jsonb;
  v_start_min int; v_end_min int; v_cur_min int;
  v_slot_start timestamp; v_slot_end timestamp;
  v_target_range tsrange; v_blk_range tsrange;
  v_has_block_conflict boolean;
  v_now_sp timestamp;
  v_min_allowed timestamp;
  v_ct RECORD;
BEGIN
  SELECT
    COALESCE(working_hours, '{}'::jsonb),
    COALESCE(days_off, '[]'::jsonb),
    COALESCE(blocked_times, '[]'::jsonb)
  INTO v_working, v_days_off, v_blocked
  FROM doctors WHERE id = p_doctor_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT consultation_duration, slot_step, buffer_before_minutes, buffer_after_minutes,
         min_notice_minutes, is_active, working_hours_override
  INTO v_ct
  FROM consultation_types
  WHERE doctor_id = p_doctor_id AND slug = p_modality;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_ct.is_active = false THEN RETURN; END IF;

  v_duration := v_ct.consultation_duration;
  v_step := COALESCE(v_ct.slot_step, v_duration);
  v_buffer_before := COALESCE(v_ct.buffer_before_minutes, 0);
  v_buffer_after := COALESCE(v_ct.buffer_after_minutes, 0);
  v_min_notice := v_ct.min_notice_minutes;

  -- Override de working_hours: se presente no tipo, prevalece
  IF v_ct.working_hours_override IS NOT NULL THEN
    v_working := v_ct.working_hours_override;
  END IF;

  IF v_days_off @> to_jsonb(p_date::text) THEN RETURN; END IF;

  v_now_sp := (now() AT TIME ZONE 'America/Sao_Paulo')::timestamp;
  v_min_allowed := v_now_sp + make_interval(mins => v_min_notice);

  v_dow := EXTRACT(DOW FROM p_date)::int::text;

  FOR v_shift IN SELECT * FROM jsonb_array_elements(COALESCE(v_working->v_dow, '[]'::jsonb))
  LOOP
    v_start_min := EXTRACT(HOUR FROM (v_shift->>'start')::time) * 60
                 + EXTRACT(MINUTE FROM (v_shift->>'start')::time);
    v_end_min   := EXTRACT(HOUR FROM (v_shift->>'end')::time) * 60
                 + EXTRACT(MINUTE FROM (v_shift->>'end')::time);

    v_cur_min := v_start_min;
    WHILE v_cur_min + v_duration <= v_end_min LOOP
      v_slot_start := (p_date + make_time(v_cur_min / 60, v_cur_min % 60, 0))::timestamp;
      v_slot_end   := v_slot_start + make_interval(mins => v_duration);
      v_target_range := tsrange(v_slot_start, v_slot_end, '[)');

      -- Aviso mínimo: ignorado quando p_ignore_min_notice = true (agendamento manual)
      IF NOT p_ignore_min_notice AND v_slot_start < v_min_allowed THEN
        v_cur_min := v_cur_min + v_step; CONTINUE;
      END IF;

      -- Conflito com appointments existentes, RESPEITANDO buffers de AMBOS os tipos.
      -- Gap exigido de cada lado = GREATEST(buffer do lado voltado da existente,
      -- buffer do lado voltado da candidata) — "o maior dos dois".
      --   depois da existente:  slot.start  < existente.end   + max(existente.after,  candidata.before)
      --   antes da existente:   slot.end    > existente.start - max(existente.before, candidata.after)
      -- Conflito = as duas condições verdadeiras (inclui o overlap cru como caso particular).
      IF EXISTS (
        SELECT 1
        FROM appointments a
        LEFT JOIN consultation_types ect
          ON ect.doctor_id = p_doctor_id
         AND ect.slug = COALESCE(a.consultation_type_slug, a.modality)
        WHERE a.doctor_id = p_doctor_id
          AND a.status NOT IN ('cancelado', 'faltou')
          AND (p_exclude_appointment_id IS NULL OR a.id <> p_exclude_appointment_id)
          AND v_slot_start < upper(a.slot_range)
                + make_interval(mins => GREATEST(COALESCE(ect.buffer_after_minutes, 0), v_buffer_before))
          AND v_slot_end   > lower(a.slot_range)
                - make_interval(mins => GREATEST(COALESCE(ect.buffer_before_minutes, 0), v_buffer_after))
      ) THEN
        v_cur_min := v_cur_min + v_step; CONTINUE;
      END IF;

      v_has_block_conflict := false;
      FOR v_blk IN SELECT * FROM jsonb_array_elements(v_blocked) WHERE value->>'date' = p_date::text
      LOOP
        v_blk_range := tsrange(
          (p_date + (v_blk->>'start')::time)::timestamp,
          (p_date + (v_blk->>'end')::time)::timestamp,
          '[)'
        );
        IF v_blk_range && v_target_range THEN
          v_has_block_conflict := true; EXIT;
        END IF;
      END LOOP;

      IF NOT v_has_block_conflict THEN
        slot_time := make_time(v_cur_min / 60, v_cur_min % 60, 0);
        RETURN NEXT;
      END IF;

      v_cur_min := v_cur_min + v_step;
    END LOOP;
  END LOOP;
END;
$function$;

-- ============================================================================
-- (2)+(3) book_appointment — advisory lock por (doctor_id, date) antes do
--         check-then-insert (fecha corrida de buffer sob concorrência).
--         Demais lógica inalterada.
-- ============================================================================
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
  -- Serializa reservas concorrentes do mesmo médico/dia (protege buffers na corrida
  -- check-then-insert; a exclusion constraint só cobre overlap cru do slot_range).
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
          'reason', CASE WHEN (v_existing->>'status') IN ('pendente','confirmado') AND (v_existing->>'date')::date >= current_date
                         THEN 'upcoming_appointment' ELSE 'awaiting_finalization' END);
      END IF;
      RAISE;
  END;
  IF p_request_id IS NOT NULL THEN
    INSERT INTO booking_requests (request_id, appointment_id, clinic_id) VALUES (p_request_id, v_apt_id, p_clinic_id) ON CONFLICT (request_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('success',true,'appointment_id',v_apt_id,'patient_id',v_patient_id,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'consultation_type_id',v_ct.id);
END; $function$;

-- ============================================================================
-- (2)+(3) reschedule_appointment — min_notice respeitado quando há requester_phone
--         (IA/paciente) e ignorado para a recepção (sem phone); advisory lock.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reschedule_appointment(
  p_appointment_id uuid, p_doctor_id uuid, p_date date, p_time time without time zone,
  p_consultation_type_id uuid DEFAULT NULL::uuid, p_modality text DEFAULT NULL::text,
  p_force boolean DEFAULT false, p_requester_phone text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Serializa contra reservas concorrentes do mesmo médico/dia.
  PERFORM pg_advisory_xact_lock(hashtext(p_doctor_id::text || '|' || p_date::text));
  IF NOT p_force THEN
    -- Antecedência mínima: respeitada quando o solicitante é paciente/IA (tem phone);
    -- ignorada para a recepção (sem phone), preservando o encaixe manual.
    IF NOT EXISTS (SELECT 1 FROM get_available_slots(p_doctor_id, p_date, v_ct.id, p_appointment_id, (p_requester_phone IS NULL)) s WHERE s.slot_time::time=p_time) THEN
      RETURN jsonb_build_object('success',false,'error_code','slot_unavailable');
    END IF;
  END IF;
  BEGIN
    UPDATE appointments SET doctor_id=p_doctor_id, date=p_date, time=p_time, duration_minutes=v_duration,
      consultation_type_id=v_ct.id, consultation_type_slug=v_type_slug, modality=v_final_modality WHERE id=p_appointment_id;
  EXCEPTION WHEN exclusion_violation THEN RETURN jsonb_build_object('success',false,'error_code','slot_conflict'); END;
  RETURN jsonb_build_object('success',true,'appointment_id',p_appointment_id,'date',p_date,'time',to_char(p_time,'HH24:MI'),'doctor_name',(SELECT name FROM doctors WHERE id=p_doctor_id));
END; $function$;

-- ============================================================================
-- (4) Segurança: tira as RPCs de escrita do alcance de anon/PUBLIC.
--     Mantém authenticated (app logado) e service_role (IA/n8n).
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.book_appointment(uuid,uuid,date,time without time zone,text,text,integer,text,text,text,uuid,uuid,uuid,uuid,boolean,boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reschedule_appointment(uuid,uuid,date,time without time zone,uuid,text,boolean,text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_appointment(uuid,text,boolean,text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.convert_lead_to_appointment(uuid,uuid,uuid,date,time without time zone,text,text,uuid,integer,uuid,uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_appointment(uuid,numeric,text,text,text,uuid[],uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reopen_ticket(uuid,uuid,boolean) FROM anon, PUBLIC;
