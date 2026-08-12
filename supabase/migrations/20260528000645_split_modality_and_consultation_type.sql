-- 20260528000645_split_modality_and_consultation_type
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1) Nova coluna consultation_type_slug
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS consultation_type_slug text;

-- 2) Backfill: copia modality atual pro novo campo (para appointments existentes)
UPDATE public.appointments
SET consultation_type_slug = modality
WHERE consultation_type_slug IS NULL;

-- 3) Corrigir modality dos appointments cujo modality não é presencial/online:
-- lookup em consultation_types e usa o modality real do tipo
UPDATE public.appointments a
SET modality = ct.modality
FROM public.consultation_types ct
WHERE ct.doctor_id = a.doctor_id
  AND ct.slug = a.modality
  AND a.modality NOT IN ('presencial','online');

-- 4) Re-adicionar CHECK constraint em modality (só presencial/online)
ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_modality_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_modality_check CHECK (modality = ANY (ARRAY['presencial'::text,'online'::text]));

-- 5) Trigger de herança de duração passa a usar consultation_type_slug
CREATE OR REPLACE FUNCTION public.fn_appointment_inherit_doctor_duration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_dur int;
  v_slug text;
BEGIN
  v_slug := COALESCE(NEW.consultation_type_slug, NEW.modality);
  SELECT consultation_duration INTO v_dur
  FROM consultation_types
  WHERE doctor_id = NEW.doctor_id AND slug = v_slug;

  IF v_dur IS NULL THEN
    SELECT COALESCE(consultation_duration, 60) INTO v_dur FROM doctors WHERE id = NEW.doctor_id;
  END IF;

  IF v_dur IS NOT NULL THEN
    NEW.duration_minutes := v_dur;
  END IF;
  RETURN NEW;
END;
$$;

-- 6) Trigger de sync ao mudar duração do consultation_type passa a usar consultation_type_slug
CREATE OR REPLACE FUNCTION public.fn_sync_appointments_on_ct_duration_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.consultation_duration IS DISTINCT FROM OLD.consultation_duration THEN
    UPDATE public.appointments
    SET duration_minutes = COALESCE(NEW.consultation_duration, 60)
    WHERE doctor_id = NEW.doctor_id
      AND COALESCE(consultation_type_slug, modality) = NEW.slug
      AND status IN ('pendente', 'confirmado');
  END IF;
  RETURN NEW;
END;
$$;
