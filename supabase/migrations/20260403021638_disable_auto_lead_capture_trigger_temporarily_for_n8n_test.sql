-- 20260403021638_disable_auto_lead_capture_trigger_temporarily_for_n8n_test
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Desativa a trigger que cria leads automaticamente ao receber mensagens
-- (Isso evita o conflito do n8n tentar criar um lead que o banco já criou milissegundos antes)
ALTER TABLE chat_messages DISABLE TRIGGER tr_chat_message_master_logic;
