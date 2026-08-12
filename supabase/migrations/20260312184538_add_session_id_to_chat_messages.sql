-- 20260312184538_add_session_id_to_chat_messages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS session_id text;
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON public.chat_messages(session_id);
COMMENT ON COLUMN public.chat_messages.session_id IS 'ID da sessão/thread usado para agrupar mensagens na memória da IA (ex: no n8n)';
