-- 20260402131629_add_google_tracking_columns
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS g_campaign_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS g_adset_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS g_ad_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS g_term_name text;
