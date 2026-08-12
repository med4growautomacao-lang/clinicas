-- 20260326162857_add_cascade_to_lead_references
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_lead_id_fkey;
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

ALTER TABLE automation_logs DROP CONSTRAINT IF EXISTS automation_logs_lead_id_fkey;
ALTER TABLE automation_logs ADD CONSTRAINT automation_logs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
