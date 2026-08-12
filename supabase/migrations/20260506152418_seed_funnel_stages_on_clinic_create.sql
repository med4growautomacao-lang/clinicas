-- 20260506152418_seed_funnel_stages_on_clinic_create
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Helper para inserir etapas padrão
CREATE OR REPLACE FUNCTION public.seed_default_funnel_stages(p_clinic_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.funnel_stages (clinic_id, name, slug, position, is_system, is_fixed, color) VALUES
    (p_clinic_id, 'Sincronização',        'sincronizacao', 0,  true,  false, 'bg-slate-500'),
    (p_clinic_id, 'Contato via Forms',    'forms',         1,  true,  false, 'bg-blue-500'),
    (p_clinic_id, 'Contato via WhatsApp', 'whatsapp',      2,  true,  false, 'bg-green-500'),
    (p_clinic_id, 'Qualificado',          null,            3,  true,  false, 'bg-yellow-500'),
    (p_clinic_id, 'Orçamento Enviado',    null,            4,  true,  false, 'bg-orange-500'),
    (p_clinic_id, 'Agendado',             null,            5,  true,  false, 'bg-purple-500'),
    (p_clinic_id, 'Compareceu',           'compareceu',    6,  true,  false, 'bg-indigo-500'),
    (p_clinic_id, 'Conversão',            'conversao',     7,  true,  true,  'bg-teal-500'),
    (p_clinic_id, 'Paciente',             null,            8,  true,  false, 'bg-emerald-500'),
    (p_clinic_id, 'Atendimento Humano',   null,            9,  true,  false, 'bg-cyan-500'),
    (p_clinic_id, 'Perdido',              'perdido',       10, true,  false, 'bg-rose-500');
END;
$$;

-- Drop e recria as 3 versões com o seed incluído
DROP FUNCTION IF EXISTS public.create_clinic_with_owner(text,text,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.create_clinic_with_owner(text,text,uuid,text,text,text,text);
DROP FUNCTION IF EXISTS public.create_clinic_with_owner(text,text,uuid,text,text,text,text,text);

CREATE FUNCTION public.create_clinic_with_owner(
  p_clinic_name text, p_plan text, p_organization_id uuid,
  p_owner_name text, p_owner_email text, p_owner_password text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_clinic_id uuid; v_user_id uuid;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    IF NOT public.can_manage_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  ELSE
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  END IF;
  INSERT INTO public.clinics (name, plan, organization_id) VALUES (p_clinic_name, p_plan, p_organization_id) RETURNING id INTO v_clinic_id;
  PERFORM public.seed_default_funnel_stages(v_clinic_id);
  IF p_owner_email IS NOT NULL AND p_owner_email != '' THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
    VALUES ('00000000-0000-0000-0000-000000000000',v_user_id,'authenticated','authenticated',p_owner_email,extensions.crypt(p_owner_password,extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
    INSERT INTO auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
    VALUES (gen_random_uuid(),v_user_id,v_user_id::text,jsonb_build_object('sub',v_user_id::text,'email',p_owner_email),'email',now(),now(),now());
    INSERT INTO public.clinic_users (id,clinic_id,role,full_name,email) VALUES (v_user_id,v_clinic_id,'gestor',COALESCE(p_owner_name,''),p_owner_email);
  END IF;
  RETURN v_clinic_id;
END;
$$;

CREATE FUNCTION public.create_clinic_with_owner(
  p_clinic_name text, p_plan text, p_organization_id uuid,
  p_owner_name text, p_owner_email text, p_owner_password text, p_owner_role text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_clinic_id uuid; v_user_id uuid;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    IF NOT public.can_manage_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  ELSE
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  END IF;
  INSERT INTO public.clinics (name, plan, organization_id) VALUES (p_clinic_name, p_plan, p_organization_id) RETURNING id INTO v_clinic_id;
  PERFORM public.seed_default_funnel_stages(v_clinic_id);
  IF p_owner_email IS NOT NULL AND p_owner_email != '' THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
    VALUES ('00000000-0000-0000-0000-000000000000',v_user_id,'authenticated','authenticated',p_owner_email,extensions.crypt(p_owner_password,extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
    INSERT INTO auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
    VALUES (gen_random_uuid(),v_user_id,v_user_id::text,jsonb_build_object('sub',v_user_id::text,'email',p_owner_email),'email',now(),now(),now());
    INSERT INTO public.clinic_users (id,clinic_id,role,full_name,email) VALUES (v_user_id,v_clinic_id,p_owner_role,COALESCE(p_owner_name,''),p_owner_email);
  END IF;
  RETURN v_clinic_id;
END;
$$;

CREATE FUNCTION public.create_clinic_with_owner(
  p_clinic_name text, p_plan text, p_organization_id uuid,
  p_owner_name text, p_owner_email text, p_owner_password text,
  p_owner_role text, p_category text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_clinic_id uuid; v_user_id uuid;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    IF NOT public.can_manage_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  ELSE
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  END IF;
  INSERT INTO public.clinics (name, plan, organization_id, category) VALUES (p_clinic_name, p_plan, p_organization_id, p_category) RETURNING id INTO v_clinic_id;
  PERFORM public.seed_default_funnel_stages(v_clinic_id);
  IF p_owner_email IS NOT NULL AND p_owner_email != '' THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
    VALUES ('00000000-0000-0000-0000-000000000000',v_user_id,'authenticated','authenticated',p_owner_email,extensions.crypt(p_owner_password,extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
    INSERT INTO auth.identities (id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
    VALUES (gen_random_uuid(),v_user_id,v_user_id::text,jsonb_build_object('sub',v_user_id::text,'email',p_owner_email),'email',now(),now(),now());
    INSERT INTO public.clinic_users (id,clinic_id,role,full_name,email) VALUES (v_user_id,v_clinic_id,p_owner_role,COALESCE(p_owner_name,''),p_owner_email);
  END IF;
  RETURN v_clinic_id;
END;
$$;
