ALTER TABLE chat_messages
  ADD COLUMN ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL;

CREATE INDEX idx_chat_messages_ticket_id ON chat_messages(ticket_id);
