-- 20260527195511_add_response_wait_seconds_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS response_wait_seconds integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ai_config.response_wait_seconds
  IS 'Segundos que a IA aguarda recebendo mensagens em rajada antes de elaborar uma resposta. 0 = resposta imediata.';
