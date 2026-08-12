-- 20260406144101_add_welcome_message_config_to_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.ai_config 
ADD COLUMN welcome_message_enabled BOOLEAN DEFAULT false,
ADD COLUMN welcome_message_text TEXT DEFAULT 'Olá! Seja bem-vindo à nossa clínica. Como podemos ajudar hoje?';
