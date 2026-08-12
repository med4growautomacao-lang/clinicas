-- 20260511123511_add_appointment_modality
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS modality text NOT NULL DEFAULT 'presencial';

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_modality_check;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_modality_check CHECK (modality IN ('presencial', 'online'));
