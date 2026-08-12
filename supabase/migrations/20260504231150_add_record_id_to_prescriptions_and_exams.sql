-- 20260504231150_add_record_id_to_prescriptions_and_exams
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE prescriptions ADD COLUMN IF NOT EXISTS record_id UUID REFERENCES medical_records(id) ON DELETE CASCADE;
ALTER TABLE exam_requests ADD COLUMN IF NOT EXISTS record_id UUID REFERENCES medical_records(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_prescriptions_record_id ON prescriptions(record_id);
CREATE INDEX IF NOT EXISTS idx_exam_requests_record_id ON exam_requests(record_id);
