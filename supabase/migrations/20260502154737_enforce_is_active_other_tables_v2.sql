-- 20260502154737_enforce_is_active_other_tables_v2
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- doctors
DROP POLICY IF EXISTS "doctors_all" ON public.doctors;
CREATE POLICY "doctors_all" ON public.doctors FOR ALL USING (
  ((clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())) AND public.is_clinic_active(clinic_id)) OR public.is_admin()
);

-- funnel_stages
DROP POLICY IF EXISTS "funnel_stages_all" ON public.funnel_stages;
CREATE POLICY "funnel_stages_all" ON public.funnel_stages FOR ALL USING (
  ((clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())) AND public.is_clinic_active(clinic_id)) OR public.is_admin()
);

-- marketing_data
DROP POLICY IF EXISTS "marketing_data_all" ON public.marketing_data;
CREATE POLICY "marketing_data_all" ON public.marketing_data FOR ALL USING (
  ((clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())) AND public.is_clinic_active(clinic_id)) OR public.is_admin()
);
