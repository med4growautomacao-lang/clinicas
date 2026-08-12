-- 20260527155041_restrict_clinics_write_to_managers
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP POLICY IF EXISTS "clinics_org_update" ON public.clinics;

CREATE POLICY "clinics_update_org_managers" ON public.clinics
  FOR UPDATE
  USING (public.can_manage_org(organization_id))
  WITH CHECK (public.can_manage_org(organization_id));

DROP POLICY IF EXISTS "clinics_delete_org_managers" ON public.clinics;
CREATE POLICY "clinics_delete_org_managers" ON public.clinics
  FOR DELETE
  USING (public.can_manage_org(organization_id));
