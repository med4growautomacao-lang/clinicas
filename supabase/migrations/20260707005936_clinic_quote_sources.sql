-- 20260707005936_clinic_quote_sources
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS quote_use_products  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quote_use_protocols boolean NOT NULL DEFAULT true;
