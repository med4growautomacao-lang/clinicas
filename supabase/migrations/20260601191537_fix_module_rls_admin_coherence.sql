-- 20260601191537_fix_module_rls_admin_coherence
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP POLICY IF EXISTS "automation_logs_all" ON public.automation_logs;
CREATE POLICY "automation_logs_all" ON public.automation_logs
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "protocols_access" ON public.protocols;
CREATE POLICY "protocols_access" ON public.protocols
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "exam_requests_access" ON public.exam_requests;
CREATE POLICY "exam_requests_access" ON public.exam_requests
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "prescriptions_access" ON public.prescriptions;
CREATE POLICY "prescriptions_access" ON public.prescriptions
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
    OR public.is_admin()
  );
