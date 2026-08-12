-- 20260402123929_add_lead_tracking_columns
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Add tracking columns to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ctwa_clid text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS fb_clid text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS g_clid text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS campaign_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS adset_name text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ad_name text;
