-- 20260528033646_ai_config_default_response_wait_10s
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.ai_config ALTER COLUMN response_wait_seconds SET DEFAULT 10;
UPDATE public.ai_config SET response_wait_seconds = 10;
