-- 20260528031922_ai_config_add_confirm_post_message
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS confirm_post_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirm_post_message text;

COMMENT ON COLUMN public.ai_config.confirm_post_enabled IS 'Se habilitado, envia uma mensagem pos-confirmacao quando o paciente confirma a consulta.';
COMMENT ON COLUMN public.ai_config.confirm_post_message IS 'Template da mensagem disparada apos o paciente confirmar a consulta. Variaveis: {paciente}, {data}, {hora}.';
