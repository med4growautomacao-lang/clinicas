-- 20260403014829_revert_source_check_and_add_origin_column
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Reverte a regra original da source (apenas meta_ads e google_ads)
ALTER TABLE leads DROP CONSTRAINT leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check 
CHECK (source = ANY (ARRAY['meta_ads'::text, 'google_ads'::text]));

-- 2. Adiciona a coluna origin se ela não existir para marcar que veio do whatsapp
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leads' AND column_name='origin') THEN
        ALTER TABLE leads ADD COLUMN origin text;
    END IF;
END $$;
