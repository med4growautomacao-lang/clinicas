-- 20260402140018_add_meta_ads_settings_to_clinics
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE clinics 
ADD COLUMN IF NOT EXISTS meta_token TEXT,
ADD COLUMN IF NOT EXISTS meta_ad_account_id TEXT,
ADD COLUMN IF NOT EXISTS meta_pixel_id TEXT;
