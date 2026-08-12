-- 20260403014535_add_whatsapp_to_leads_source_check
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Remove a regra antiga
ALTER TABLE leads DROP CONSTRAINT leads_source_check;

-- 2. Cria a nova regra incluindo 'whatsapp'
ALTER TABLE leads ADD CONSTRAINT leads_source_check 
CHECK (source = ANY (ARRAY['meta_ads'::text, 'google_ads'::text, 'whatsapp'::text]));
