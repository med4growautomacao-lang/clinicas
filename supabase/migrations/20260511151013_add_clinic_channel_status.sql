-- 20260511151013_add_clinic_channel_status
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS meta_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS google_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS site_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS forms_status text NOT NULL DEFAULT 'none';

ALTER TABLE clinics
  DROP CONSTRAINT IF EXISTS clinics_channel_status_check;

ALTER TABLE clinics
  ADD CONSTRAINT clinics_channel_status_check CHECK (
    meta_status IN ('none', 'inactive', 'active') AND
    google_status IN ('none', 'inactive', 'active') AND
    site_status IN ('none', 'inactive', 'active') AND
    forms_status IN ('none', 'inactive', 'active')
  );
