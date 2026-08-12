-- 20260601195336_conversion_stage_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.funnel_stages
  ADD COLUMN IF NOT EXISTS is_conversion boolean NOT NULL DEFAULT false;

UPDATE public.funnel_stages s
   SET is_conversion = true
 WHERE s.slug = 'ganho'
   AND NOT EXISTS (
     SELECT 1 FROM public.funnel_stages s2
      WHERE s2.clinic_id = s.clinic_id AND s2.is_conversion
   );

CREATE UNIQUE INDEX IF NOT EXISTS funnel_stages_one_conversion_per_clinic
  ON public.funnel_stages (clinic_id) WHERE is_conversion;
