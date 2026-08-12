-- 20260414132531_remove_duplicate_chat_message_trigger
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP TRIGGER IF EXISTS trg_prevent_duplicate_chat_message ON chat_messages;
DROP FUNCTION IF EXISTS prevent_duplicate_chat_message();
