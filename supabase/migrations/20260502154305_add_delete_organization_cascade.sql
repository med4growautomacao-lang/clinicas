-- 20260502154305_add_delete_organization_cascade
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.delete_organization_cascade(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE 
  v_user_id uuid;
  v_clinic_id uuid;
BEGIN 
  -- Security check (only super-admin)
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- 1. Delete all clinics in this organization (using their cascade function)
  FOR v_clinic_id IN SELECT id FROM public.clinics WHERE organization_id = p_org_id LOOP
    -- Note: we use public.delete_clinic_cascade which already handles security and data
    PERFORM public.delete_clinic_cascade(v_clinic_id);
  END LOOP;

  -- 2. Delete all organization users from auth.users
  FOR v_user_id IN SELECT id FROM public.org_users WHERE organization_id = p_org_id LOOP
    DELETE FROM auth.users WHERE id = v_user_id;
  END LOOP;
  
  -- 3. Delete the organization itself
  -- (Related rows in org_users will be deleted by FK cascade if not already gone)
  DELETE FROM public.organizations WHERE id = p_org_id;
END;
$$;
