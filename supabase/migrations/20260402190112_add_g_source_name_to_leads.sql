-- 20260402190112_add_g_source_name_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS g_source_name TEXT;

COMMENT ON COLUMN public.leads.g_source_name IS 'Nome do recurso de origem/placement do Google Ads';
