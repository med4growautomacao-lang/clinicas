-- 20260511181811_phase1_appointment_duration_and_overlap
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Fase 1: Sistema robusto de slots
-- 1. duration_minutes em appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes int NOT NULL DEFAULT 60;

UPDATE appointments a
SET duration_minutes = COALESCE(d.consultation_duration, 60)
FROM doctors d
WHERE a.doctor_id = d.id
  AND a.duration_minutes = 60;

-- 2. Generated column tsrange (com make_interval, que é IMMUTABLE)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS slot_range tsrange
  GENERATED ALWAYS AS (
    tsrange(
      (date + time)::timestamp,
      (date + time)::timestamp + make_interval(mins => duration_minutes),
      '[)'
    )
  ) STORED;

-- 3. EXCLUDE constraint
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
  DROP CONSTRAINT IF EXISTS appointments_no_overlap_per_doctor;

ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap_per_doctor EXCLUDE USING gist (
    doctor_id WITH =,
    slot_range WITH &&
  ) WHERE (status NOT IN ('cancelado', 'faltou'));

-- 4. slot_step em doctors
ALTER TABLE doctors ADD COLUMN IF NOT EXISTS slot_step int;

-- 5. Tabela de idempotência
CREATE TABLE IF NOT EXISTS booking_requests (
  request_id uuid PRIMARY KEY,
  appointment_id uuid REFERENCES appointments(id) ON DELETE CASCADE,
  clinic_id uuid REFERENCES clinics(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_requests_clinic ON booking_requests(clinic_id);
