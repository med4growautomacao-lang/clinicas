-- 20260507160224_add_compareceu_to_appointments_status_check
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check 
  CHECK (status = ANY (ARRAY['pendente','confirmado','compareceu','realizado','cancelado','faltou']));
