-- 20260312173135_remove_api_url_from_whatsapp_instances
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.whatsapp_instances DROP COLUMN IF EXISTS api_url;
