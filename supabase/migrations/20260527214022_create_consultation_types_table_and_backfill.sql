-- 20260527214022_create_consultation_types_table_and_backfill
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1) Tabela consultation_types
CREATE TABLE IF NOT EXISTS public.consultation_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id),
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  modality text NOT NULL CHECK (modality IN ('presencial','online')),
  is_active boolean NOT NULL DEFAULT true,
  consultation_duration int NOT NULL DEFAULT 60,
  slot_step int,
  buffer_before_minutes int NOT NULL DEFAULT 0,
  buffer_after_minutes int NOT NULL DEFAULT 0,
  min_notice_minutes int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_consultation_types_doctor ON public.consultation_types(doctor_id);

-- 2) RLS
ALTER TABLE public.consultation_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consultation_types_all ON public.consultation_types;
CREATE POLICY consultation_types_all ON public.consultation_types FOR ALL TO authenticated
  USING ((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE clinic_users.id = auth.uid())) OR is_admin())
  WITH CHECK ((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE clinic_users.id = auth.uid())) OR is_admin());
DROP POLICY IF EXISTS consultation_types_org_access ON public.consultation_types;
CREATE POLICY consultation_types_org_access ON public.consultation_types FOR SELECT
  USING (clinic_id IN (SELECT c.id FROM clinics c JOIN org_users ou ON ou.organization_id = c.organization_id WHERE ou.user_id = auth.uid()));

-- 3) Backfill: tipo 'presencial' pra todo médico
INSERT INTO public.consultation_types
  (clinic_id, doctor_id, slug, name, modality, consultation_duration, slot_step,
   buffer_before_minutes, buffer_after_minutes, min_notice_minutes)
SELECT
  d.clinic_id, d.id,
  'presencial', 'Presencial', 'presencial',
  COALESCE(d.consultation_duration, 60),
  d.slot_step,
  COALESCE(d.buffer_before_minutes, 0),
  COALESCE(d.buffer_after_minutes, 0),
  COALESCE(d.min_notice_minutes, 0)
FROM public.doctors d
WHERE NOT EXISTS (
  SELECT 1 FROM public.consultation_types ct WHERE ct.doctor_id = d.id AND ct.slug = 'presencial'
);

-- 4) Backfill: tipo 'online' pra médicos que JÁ têm appointments online
INSERT INTO public.consultation_types
  (clinic_id, doctor_id, slug, name, modality, consultation_duration, slot_step,
   buffer_before_minutes, buffer_after_minutes, min_notice_minutes)
SELECT
  d.clinic_id, d.id,
  'online', 'Online', 'online',
  COALESCE(d.consultation_duration, 60),
  d.slot_step,
  COALESCE(d.buffer_before_minutes, 0),
  COALESCE(d.buffer_after_minutes, 0),
  COALESCE(d.min_notice_minutes, 0)
FROM public.doctors d
WHERE EXISTS (
  SELECT 1 FROM public.appointments a WHERE a.doctor_id = d.id AND a.modality = 'online'
)
AND NOT EXISTS (
  SELECT 1 FROM public.consultation_types ct WHERE ct.doctor_id = d.id AND ct.slug = 'online'
);

-- 5) get_available_slots: novo parâmetro p_modality, lê de consultation_types com fallback em doctors
CREATE OR REPLACE FUNCTION public.get_available_slots(
  p_doctor_id uuid,
  p_date date,
  p_modality text DEFAULT 'presencial',
  p_exclude_appointment_id uuid DEFAULT NULL
)
RETURNS TABLE(slot_time time without time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
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
    COALESCE(blocked_times, '[]'::jsonb),
    COALESCE(consultation_duration, 60),
    slot_step,
    COALESCE(buffer_before_minutes, 0),
    COALESCE(buffer_after_minutes, 0),
    COALESCE(min_notice_minutes, 0)
  INTO v_working, v_days_off, v_blocked,
       v_duration, v_step, v_buffer_before, v_buffer_after, v_min_notice
  FROM doctors WHERE id = p_doctor_id;

  IF NOT FOUND THEN RETURN; END IF;

  SELECT consultation_duration, slot_step, buffer_before_minutes, buffer_after_minutes, min_notice_minutes, is_active
  INTO v_ct
  FROM consultation_types
  WHERE doctor_id = p_doctor_id AND slug = p_modality;

  IF FOUND THEN
    IF v_ct.is_active = false THEN RETURN; END IF;
    v_duration := v_ct.consultation_duration;
    v_step := v_ct.slot_step;
    v_buffer_before := v_ct.buffer_before_minutes;
    v_buffer_after := v_ct.buffer_after_minutes;
    v_min_notice := v_ct.min_notice_minutes;
  END IF;

  v_step := COALESCE(v_step, v_duration);

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

      IF v_slot_start < v_min_allowed THEN
        v_cur_min := v_cur_min + v_step; CONTINUE;
      END IF;

      -- Sobreposição com appointments do médico (qualquer modality)
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
$$;

-- 6) Trigger de herança de duração agora olha consultation_types primeiro
CREATE OR REPLACE FUNCTION public.fn_appointment_inherit_doctor_duration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_dur int;
BEGIN
  SELECT consultation_duration INTO v_dur
  FROM consultation_types
  WHERE doctor_id = NEW.doctor_id AND slug = NEW.modality;

  IF v_dur IS NULL THEN
    SELECT COALESCE(consultation_duration, 60) INTO v_dur
    FROM doctors WHERE id = NEW.doctor_id;
  END IF;

  IF v_dur IS NOT NULL THEN
    NEW.duration_minutes := v_dur;
  END IF;
  RETURN NEW;
END;
$$;

-- 7) Substituir o trigger de sync: agora dispara em consultation_types, não em doctors
DROP TRIGGER IF EXISTS trg_sync_appointments_on_doctor_duration ON public.doctors;
DROP FUNCTION IF EXISTS public.fn_sync_appointments_on_doctor_duration_change() CASCADE;

CREATE OR REPLACE FUNCTION public.fn_sync_appointments_on_ct_duration_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.consultation_duration IS DISTINCT FROM OLD.consultation_duration THEN
    UPDATE public.appointments
    SET duration_minutes = COALESCE(NEW.consultation_duration, 60)
    WHERE doctor_id = NEW.doctor_id
      AND modality = NEW.slug
      AND status IN ('pendente', 'confirmado');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_appointments_on_ct_duration ON public.consultation_types;
CREATE TRIGGER trg_sync_appointments_on_ct_duration
AFTER UPDATE ON public.consultation_types
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_appointments_on_ct_duration_change();
