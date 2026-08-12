-- 20260312154739_add_prompt_to_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.ai_config ADD COLUMN prompt text DEFAULT 'Você é uma assistente virtual de uma clínica médica. Seu objetivo é ajudar pacientes com agendamentos, dúvidas sobre procedimentos e informações gerais da clínica de forma cordial e eficiente.';
COMMENT ON COLUMN public.ai_config.prompt IS 'Prompt base para a personalidade e instruções da IA';
