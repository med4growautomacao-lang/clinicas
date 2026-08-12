-- 20260312230828_enable_realtime_for_chat_messages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Habilitar realtime para a tabela chat_messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
