-- 20260707011321_clinic_quote_template
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS quote_template jsonb NOT NULL DEFAULT '{}'::jsonb;
