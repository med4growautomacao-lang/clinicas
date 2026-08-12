-- 20260403014945_remove_temp_origin_column_and_keep_capture_channel_logic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove a coluna origin que criei temporariamente para manter seu banco limpo
ALTER TABLE leads DROP COLUMN IF EXISTS origin;

-- Garante que a regra da source continue intacta (apenas meta/google)
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check 
CHECK (source = ANY (ARRAY['meta_ads'::text, 'google_ads'::text]));
