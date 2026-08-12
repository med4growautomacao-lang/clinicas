-- 20260601190428_fix_lead_stage_history_rls_admin
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP POLICY IF EXISTS "Enable all access for clinic users on lead stage history" ON public.lead_stage_history;

CREATE POLICY "lead_stage_history_all" ON public.lead_stage_history
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

CREATE POLICY "lead_stage_history_org_access" ON public.lead_stage_history
  FOR ALL
  USING (
    (
      clinic_id IN (
        SELECT c.id FROM public.clinics c
        JOIN public.org_users ou ON ou.organization_id = c.organization_id
        WHERE ou.user_id = auth.uid()
      )
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );
