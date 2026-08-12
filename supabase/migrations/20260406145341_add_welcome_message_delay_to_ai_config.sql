-- 20260406145341_add_welcome_message_delay_to_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.ai_config 
ADD COLUMN IF NOT EXISTS welcome_message_delay INTEGER DEFAULT 5;

COMMENT ON COLUMN public.ai_config.welcome_message_delay IS 'Delay in minutes to wait before sending the welcome message to a new lead from form.';
