-- 20260511192421_get_available_slots_exclude_appointment
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_exclude_appointment_id uuid DEFAULT NULL
) RETURNS TABLE(slot_time time)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_duration int;
  v_step int;
  v_working jsonb;
  v_days_off jsonb;
  v_blocked jsonb;
  v_dow text;
  v_shift jsonb;
  v_blk jsonb;
  v_start_min int;
  v_end_min int;
  v_cur_min int;
  v_slot_start timestamp;
  v_slot_end timestamp;
  v_target_range tsrange;
  v_blk_range tsrange;
  v_has_block_conflict boolean;
BEGIN
  SELECT
    COALESCE(consultation_duration, 60),
    COALESCE(slot_step, COALESCE(consultation_duration, 60)),
    COALESCE(working_hours, '{}'::jsonb),
    COALESCE(days_off, '[]'::jsonb),
    COALESCE(blocked_times, '[]'::jsonb)
  INTO v_duration, v_step, v_working, v_days_off, v_blocked
  FROM doctors
  WHERE id = p_doctor_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF v_days_off @> to_jsonb(p_date::text) THEN RETURN; END IF;

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

      -- Sobreposição com appointments? (exclui o appointment que está sendo editado, se informado)
      IF EXISTS (
        SELECT 1 FROM appointments
        WHERE doctor_id = p_doctor_id
          AND status NOT IN ('cancelado', 'faltou')
          AND slot_range && v_target_range
          AND (p_exclude_appointment_id IS NULL OR id <> p_exclude_appointment_id)
      ) THEN
        v_cur_min := v_cur_min + v_step;
        CONTINUE;
      END IF;

      -- Bloqueios manuais do dia
      v_has_block_conflict := false;
      FOR v_blk IN SELECT * FROM jsonb_array_elements(v_blocked) WHERE value->>'date' = p_date::text
      LOOP
        v_blk_range := tsrange(
          (p_date + (v_blk->>'start')::time)::timestamp,
          (p_date + (v_blk->>'end')::time)::timestamp,
          '[)'
        );
        IF v_blk_range && v_target_range THEN
          v_has_block_conflict := true;
          EXIT;
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
$$;

GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, date, uuid) TO anon, authenticated, service_role;
