-- Fix can_manage_org to allow both org_owner and org_admin roles to manage the organization
-- This resolves the "Access denied" error when org_admin users try to create a clinic or add a user to the org

CREATE OR REPLACE FUNCTION public.can_manage_org(p_org_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_is_super_admin boolean;
  v_is_org_manager boolean;
BEGIN
  -- Check if super admin
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_users WHERE id = auth.uid() AND role = 'super-admin'
  ) INTO v_is_super_admin;
  
  IF v_is_super_admin THEN
    RETURN true;
  END IF;

  IF p_org_id IS NOT NULL THEN
    -- Now allows both org_owner AND org_admin
    SELECT EXISTS (
      SELECT 1 FROM public.org_users 
      WHERE user_id = auth.uid() 
        AND organization_id = p_org_id 
        AND role IN ('org_owner', 'org_admin')
    ) INTO v_is_org_manager;
    
    IF v_is_org_manager THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$function$;
