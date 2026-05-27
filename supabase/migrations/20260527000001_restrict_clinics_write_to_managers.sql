-- Restrict UPDATE/DELETE on clinics to org_owner/org_admin via can_manage_org()
-- The previous "clinics_org_update" policy allowed ANY member of the organization
-- (including org_team) to update clinics, which is too permissive for actions like
-- toggling is_active or deleting a clinic.

DROP POLICY IF EXISTS "clinics_org_update" ON public.clinics;

CREATE POLICY "clinics_update_org_managers" ON public.clinics
  FOR UPDATE
  USING (public.can_manage_org(organization_id))
  WITH CHECK (public.can_manage_org(organization_id));

DROP POLICY IF EXISTS "clinics_delete_org_managers" ON public.clinics;
CREATE POLICY "clinics_delete_org_managers" ON public.clinics
  FOR DELETE
  USING (public.can_manage_org(organization_id));
