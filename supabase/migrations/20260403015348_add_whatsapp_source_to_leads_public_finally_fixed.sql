-- 20260403015348_add_whatsapp_source_to_leads_public_finally_fixed
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove a regra da tabela leads (o erro do print aponta para leads)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;

-- Recria permitindo whatsapp, além de meta e google
ALTER TABLE leads ADD CONSTRAINT leads_source_check 
CHECK (source = ANY (ARRAY['meta_ads'::text, 'google_ads'::text, 'whatsapp'::text]));
