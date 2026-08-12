-- 20260402192035_add_rast_id_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS rast_id TEXT;

COMMENT ON COLUMN public.leads.rast_id IS 'ID único de rastreamento para integração com pixels e APIs de conversão';
