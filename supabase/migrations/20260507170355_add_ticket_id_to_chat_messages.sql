-- 20260507170355_add_ticket_id_to_chat_messages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE chat_messages
  ADD COLUMN ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;

CREATE INDEX idx_chat_messages_ticket_id ON chat_messages(ticket_id);
