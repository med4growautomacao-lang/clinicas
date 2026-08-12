-- 20260504223941_create_prescriptions_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE IF NOT EXISTS prescriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  doctor_id UUID REFERENCES doctors(id) ON DELETE SET NULL,
  medications JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_clinic_patient ON prescriptions(clinic_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_created_at ON prescriptions(created_at DESC);

ALTER TABLE prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prescriptions_access" ON prescriptions
  FOR ALL USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE id = auth.uid()
      UNION
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );
