-- 20260402135055_update_leads_source_check_constraint
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE leads DROP CONSTRAINT leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source = ANY (ARRAY['meta_ads', 'google_ads', 'facebook_ads', 'google', 'whatsapp', 'instagram', 'indicacao', 'site', 'manual']));
