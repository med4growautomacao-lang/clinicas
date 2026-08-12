-- 20260528015950_consultation_type_id_and_description
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1) Description em consultation_types
ALTER TABLE public.consultation_types ADD COLUMN IF NOT EXISTS description text;

-- 2) FK consultation_type_id em appointments
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS consultation_type_id uuid REFERENCES public.consultation_types(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_consultation_type ON public.appointments(consultation_type_id);

-- 3) Backfill: preencher consultation_type_id via lookup (doctor_id, slug)
UPDATE public.appointments a
SET consultation_type_id = ct.id
FROM public.consultation_types ct
WHERE ct.doctor_id = a.doctor_id
  AND ct.slug = COALESCE(a.consultation_type_slug, a.modality)
  AND a.consultation_type_id IS NULL;
