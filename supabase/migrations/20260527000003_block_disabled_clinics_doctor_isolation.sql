-- Médicos/gestores/secretárias também não devem ver appointments/prontuários
-- de clínica desativada (essas 3 policies tinham filtro por role mas não por clínica)
DROP POLICY IF EXISTS "appointments_doctor_isolation" ON public.appointments;
CREATE POLICY "appointments_doctor_isolation" ON public.appointments
  FOR SELECT
  USING (
    (
      (
        doctor_id IN (SELECT d.id FROM public.doctors d WHERE d.user_id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.clinic_users
          WHERE clinic_users.id = auth.uid()
            AND clinic_users.role = ANY (ARRAY['gestor','medico_gestor','secretaria'])
        )
      )
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "medical_records_doctor_isolation" ON public.medical_records;
CREATE POLICY "medical_records_doctor_isolation" ON public.medical_records
  FOR SELECT
  USING (
    (
      (
        doctor_id IN (SELECT d.id FROM public.doctors d WHERE d.user_id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.clinic_users
          WHERE clinic_users.id = auth.uid()
            AND clinic_users.role = ANY (ARRAY['gestor','medico_gestor','secretaria'])
        )
      )
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "gestor_can_reset" ON public.prontuario_passwords;
CREATE POLICY "gestor_can_reset" ON public.prontuario_passwords
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id = prontuario_passwords.clinic_id
        AND cu.role IN ('gestor', 'medico_gestor')
    )
    AND public.is_clinic_active(prontuario_passwords.clinic_id)
  );
