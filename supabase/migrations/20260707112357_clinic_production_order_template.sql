-- 20260707112357_clinic_production_order_template
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS production_order_template jsonb NOT NULL DEFAULT '{}'::jsonb;
