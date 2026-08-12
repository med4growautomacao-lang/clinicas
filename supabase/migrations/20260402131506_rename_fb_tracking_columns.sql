-- 20260402131506_rename_fb_tracking_columns
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE leads RENAME COLUMN campaign_name TO fb_campaign_name;
ALTER TABLE leads RENAME COLUMN adset_name TO fb_adset_name;
ALTER TABLE leads RENAME COLUMN ad_name TO fb_ad_name;
