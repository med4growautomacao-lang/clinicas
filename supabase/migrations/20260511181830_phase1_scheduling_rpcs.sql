-- 20260511181830_phase1_scheduling_rpcs
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- RPC 1: get_available_slots
-- Gera grid de slots respeitando working_hours, slot_step, consultation_duration,
-- e exclui slots que sobreponham com appointments existentes (não cancelados/faltou)
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id uuid,
  p_date date
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
  v_days_off text[];
  v_dow text;
  v_shift jsonb;
  v_start_min int;
  v_end_min int;
  v_cur_min int;
  v_slot_start timestamp;
  v_slot_end timestamp;
  v_target_range tsrange;
BEGIN
  SELECT
    COALESCE(consultation_duration, 60),
    COALESCE(slot_step, COALESCE(consultation_duration, 60)),
    COALESCE(working_hours, '{}'::jsonb),
    COALESCE(days_off, ARRAY[]::text[])
  INTO v_duration, v_step, v_working, v_days_off
  FROM doctors
  WHERE id = p_doctor_id;

  IF NOT FOUND THEN RETURN; END IF;
  IF p_date::text = ANY(v_days_off) THEN RETURN; END IF;

  -- Dia da semana: getDay() = 0 (dom) .. 6 (sab). EXTRACT(DOW) faz o mesmo
  v_dow := EXTRACT(DOW FROM p_date)::int::text;

  -- Para cada turno do dia (working_hours[dow] é array de {start, end})
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

      -- Verifica sobreposição com agendamentos existentes
      IF NOT EXISTS (
        SELECT 1 FROM appointments
        WHERE doctor_id = p_doctor_id
          AND status NOT IN ('cancelado', 'faltou')
          AND slot_range && v_target_range
      ) THEN
        slot_time := make_time(v_cur_min / 60, v_cur_min % 60, 0);
        RETURN NEXT;
      END IF;

      v_cur_min := v_cur_min + v_step;
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_available_slots(uuid, date) TO anon, authenticated, service_role;
