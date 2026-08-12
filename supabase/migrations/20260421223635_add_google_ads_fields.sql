-- 20260421223635_add_google_ads_fields
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS google_ad_account_id text;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS google_ad_mcc_id text,
  ADD COLUMN IF NOT EXISTS google_ad_mcc_token text;
