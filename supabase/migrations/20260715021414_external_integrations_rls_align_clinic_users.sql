-- 20260715021414_external_integrations_rls_align_clinic_users
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- As policies originais eram MAIS restritas que a própria tabela clinics: só is_clinic_admin/super.
-- Isso barrava o login de clínica comum (membro de clinic_users, sem org_users) — daí "algumas
-- clínicas apareciam, outras não". Alinhamos ao modelo da clinics.clinics_all: membro de
-- clinic_users daquela clínica OU is_clinic_admin (que já cobre super-admin e org_users).

-- clinic_external_integrations
DROP POLICY IF EXISTS cei_select ON public.clinic_external_integrations;
DROP POLICY IF EXISTS cei_insert ON public.clinic_external_integrations;
DROP POLICY IF EXISTS cei_update ON public.clinic_external_integrations;

CREATE POLICY cei_select ON public.clinic_external_integrations
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())
    OR public.is_clinic_admin(clinic_id)
  );
CREATE POLICY cei_insert ON public.clinic_external_integrations
  FOR INSERT WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())
    OR public.is_clinic_admin(clinic_id)
  );
CREATE POLICY cei_update ON public.clinic_external_integrations
  FOR UPDATE USING (
    clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())
    OR public.is_clinic_admin(clinic_id)
  ) WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())
    OR public.is_clinic_admin(clinic_id)
  );

-- external_form_submissions (ledger — mesma régua de leitura)
DROP POLICY IF EXISTS efs_select ON public.external_form_submissions;
CREATE POLICY efs_select ON public.external_form_submissions
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())
    OR public.is_clinic_admin(clinic_id)
  );
