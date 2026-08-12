-- 20260504225948_create_exam_requests_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE IF NOT EXISTS exam_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
  exams JSONB NOT NULL DEFAULT '[]'::jsonb,
  clinical_indication TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_requests_clinic_patient ON exam_requests(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_exam_requests_created_at ON exam_requests(created_at DESC);

ALTER TABLE exam_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exam_requests_access" ON exam_requests
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE id = auth.uid()
      UNION
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );
