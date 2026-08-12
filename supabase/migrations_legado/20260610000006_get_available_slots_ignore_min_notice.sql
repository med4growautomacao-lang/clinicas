-- Permite ignorar o "aviso mínimo" (min_notice_minutes) ao buscar horários disponíveis.
-- Uso: agendamento manual pelo modal (Appointments) passa p_ignore_min_notice = true,
-- liberando qualquer horário dentro do expediente. Mantém todas as demais regras
-- (expediente, bloqueios, folgas, buffers e conflito de horário/double-booking).
--
-- IA (ai-scheduler) e agendamento via Kanban NÃO passam a flag, então continuam
-- respeitando o aviso mínimo (default false).
--
-- Como adicionar um parâmetro cria uma nova assinatura, derrubamos os overloads
-- antigos e recriamos com o parâmetro extra (com DEFAULT, preservando os callers).

DROP FUNCTION IF EXISTS public.get_available_slots(uuid, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_available_slots(uuid, date, text, uuid);

-- Overload base (por modalidade/slug)
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
  v_buffer_before := v_ct.buffer_before_minutes;
  v_buffer_after := v_ct.buffer_after_minutes;
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

      IF EXISTS (
        SELECT 1 FROM appointments
        WHERE doctor_id = p_doctor_id
          AND status NOT IN ('cancelado', 'faltou')
          AND tsrange(
                lower(slot_range) - make_interval(mins => v_buffer_before),
                upper(slot_range) + make_interval(mins => v_buffer_after),
                '[)'
              ) && v_target_range
          AND (p_exclude_appointment_id IS NULL OR id <> p_exclude_appointment_id)
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

-- Overload por tipo de consulta (resolve o slug e delega ao overload base)
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_consultation_type_id uuid,
  p_exclude_appointment_id uuid DEFAULT NULL::uuid,
  p_ignore_min_notice boolean DEFAULT false
)
 RETURNS TABLE(slot_time time without time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
BEGIN
  SELECT slug INTO v_slug FROM consultation_types WHERE id = p_consultation_type_id AND doctor_id = p_doctor_id;
  IF v_slug IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM public.get_available_slots(p_doctor_id, p_date, v_slug, p_exclude_appointment_id, p_ignore_min_notice);
END;
$function$;
