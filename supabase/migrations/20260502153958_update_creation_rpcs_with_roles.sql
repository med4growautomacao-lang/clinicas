-- 20260502153958_update_creation_rpcs_with_roles
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Update create_clinic_with_owner to support role
CREATE OR REPLACE FUNCTION public.create_clinic_with_owner(
  p_clinic_name text,
  p_plan text,
  p_organization_id uuid,
  p_owner_name text,
  p_owner_email text,
  p_owner_password text,
  p_owner_role text DEFAULT 'gestor'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE 
  v_clinic_id uuid; 
  v_user_id uuid; 
BEGIN 
  IF p_organization_id IS NOT NULL THEN
    IF NOT public.can_manage_org(p_organization_id) THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  ELSE
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
  END IF;

  INSERT INTO public.clinics (name, plan, organization_id) 
  VALUES (p_clinic_name, p_plan, p_organization_id) RETURNING id INTO v_clinic_id; 
  
  IF p_owner_email IS NOT NULL AND p_owner_email != '' THEN 
    v_user_id := gen_random_uuid(); 
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token) 
    VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', p_owner_email, extensions.crypt(p_owner_password, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''); 
    
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) 
    VALUES (gen_random_uuid(), v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', p_owner_email), 'email', now(), now(), now()); 
    
    INSERT INTO public.clinic_users (id, clinic_id, role, full_name, email) 
    VALUES (v_user_id, v_clinic_id, p_owner_role, COALESCE(p_owner_name, ''), p_owner_email); 
  END IF; 
  
  RETURN v_clinic_id; 
END;
$$;

-- Create create_org_with_owner
CREATE OR REPLACE FUNCTION public.create_org_with_owner(
  p_org_name text,
  p_plan text,
  p_owner_name text,
  p_owner_email text,
  p_owner_password text,
  p_owner_role text DEFAULT 'org_owner'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE 
  v_org_id uuid; 
  v_user_id uuid; 
BEGIN 
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  INSERT INTO public.organizations (name, plan) 
  VALUES (p_org_name, p_plan) RETURNING id INTO v_org_id; 
  
  IF p_owner_email IS NOT NULL AND p_owner_email != '' THEN 
    v_user_id := gen_random_uuid(); 
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token) 
    VALUES ('00000000-0000-0000-0000-000000000000', v_user_id, 'authenticated', 'authenticated', p_owner_email, extensions.crypt(p_owner_password, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''); 
    
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at) 
    VALUES (gen_random_uuid(), v_user_id, v_user_id::text, jsonb_build_object('sub', v_user_id::text, 'email', p_owner_email), 'email', now(), now(), now()); 
    
    INSERT INTO public.org_users (id, organization_id, role, full_name, email) 
    VALUES (v_user_id, v_org_id, p_owner_role, COALESCE(p_owner_name, ''), p_owner_email); 
  END IF; 
  
  RETURN v_org_id; 
END;
$$;
