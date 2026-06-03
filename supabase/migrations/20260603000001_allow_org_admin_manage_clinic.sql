-- Allow org_admin (not only org_owner) to manage clinics via can_manage_clinic().
-- Background: 20260522000001 fixed can_manage_org() to allow both org_owner and
-- org_admin, and 20260527000001 restricts clinic UPDATE/DELETE at the RLS level to
-- can_manage_org(). However, delete_clinic_cascade(), add_user_to_clinic() and
-- remove_user_from_clinic() are SECURITY DEFINER functions that gate on
-- can_manage_clinic(), which still only recognized org_owner. As a result an
-- org_admin received "Access denied" when deleting a clinic.
--
-- This aligns can_manage_clinic() with can_manage_org() by also accepting org_admin.

CREATE OR REPLACE FUNCTION public.can_manage_clinic(p_clinic_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_org_id uuid;
  v_is_super_admin boolean;
  v_is_org_manager boolean;
  v_is_clinic_gestor boolean;
BEGIN
  -- Check if super admin
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_users WHERE id = auth.uid() AND role = 'super-admin'
  ) INTO v_is_super_admin;

  IF v_is_super_admin THEN
    RETURN true;
  END IF;

  -- Check if gestor of this clinic
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_users WHERE id = auth.uid() AND clinic_id = p_clinic_id AND role = 'gestor'
  ) INTO v_is_clinic_gestor;

  IF v_is_clinic_gestor THEN
    RETURN true;
  END IF;

  -- Check if org owner OR org admin of the clinic's organization
  SELECT organization_id INTO v_org_id FROM public.clinics WHERE id = p_clinic_id;

  IF v_org_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.org_users
      WHERE user_id = auth.uid()
        AND organization_id = v_org_id
        AND role IN ('org_owner', 'org_admin')
    ) INTO v_is_org_manager;

    IF v_is_org_manager THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$function$;
