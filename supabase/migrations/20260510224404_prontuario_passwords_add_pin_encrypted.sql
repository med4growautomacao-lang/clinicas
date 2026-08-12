-- 20260510224404_prontuario_passwords_add_pin_encrypted
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE prontuario_passwords ADD COLUMN IF NOT EXISTS pin_encrypted text;
