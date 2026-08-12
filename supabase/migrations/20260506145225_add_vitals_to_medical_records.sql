-- 20260506145225_add_vitals_to_medical_records
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.medical_records
  ADD COLUMN IF NOT EXISTS weight varchar(20) NULL,
  ADD COLUMN IF NOT EXISTS height varchar(20) NULL,
  ADD COLUMN IF NOT EXISTS blood_pressure varchar(20) NULL,
  ADD COLUMN IF NOT EXISTS temperature varchar(10) NULL;
