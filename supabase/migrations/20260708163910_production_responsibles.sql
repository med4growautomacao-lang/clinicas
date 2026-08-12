-- 20260708163910_production_responsibles
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE IF NOT EXISTS public.production_responsibles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS production_responsibles_clinic_idx ON public.production_responsibles (clinic_id);
CREATE UNIQUE INDEX IF NOT EXISTS production_responsibles_clinic_name_uq ON public.production_responsibles (clinic_id, lower(name));

ALTER TABLE public.production_responsibles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_responsibles_access ON public.production_responsibles;
CREATE POLICY production_responsibles_access ON public.production_responsibles AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));
