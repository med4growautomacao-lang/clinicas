-- 20260402135239_purge_unsupported_lead_sources_and_update_constraint
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Set unsupported sources to NULL so the constraint can be applied
UPDATE leads SET source = NULL WHERE source NOT IN ('meta_ads', 'google_ads');

-- Update the constraint
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source = ANY (ARRAY['meta_ads', 'google_ads']));
