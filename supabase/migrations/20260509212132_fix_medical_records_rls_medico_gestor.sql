-- 20260509212132_fix_medical_records_rls_medico_gestor
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP POLICY IF EXISTS medical_records_doctor_isolation ON medical_records;

CREATE POLICY medical_records_doctor_isolation ON medical_records
FOR SELECT USING (
  (doctor_id IN (SELECT d.id FROM doctors d WHERE d.user_id = auth.uid()))
  OR (EXISTS (
    SELECT 1 FROM clinic_users 
    WHERE clinic_users.id = auth.uid() 
    AND clinic_users.role = ANY (ARRAY['gestor', 'medico_gestor', 'secretaria'])
  ))
);
