-- FASE 1b: fecha o bypass cross-org de is_admin() nas 4 RPCs DEFINER de administração e remove
-- is_admin() de vez. is_admin() retorna true para QUALQUER membro de org_users sem correlacionar
-- a org do chamador com o alvo — logo um usuário de uma org apagava a org de outro cliente.
--
-- Guards corretos: criar org do zero é ação de super-admin; apagar org é super-admin OU quem
-- gerencia AQUELA org; criar clínica sem org é super-admin (o ramo com org já usava can_manage_org).
-- Aproveito para fixar search_path='public' (as 4 eram DEFINER sem search_path — risco de injeção).

create or replace function public.create_org_with_owner(p_org_name text, p_plan text, p_owner_name text, p_owner_email text, p_owner_password text, p_owner_role text DEFAULT 'org_owner'::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
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
$function$;

create or replace function public.delete_organization_cascade(p_org_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_user_id uuid;
  v_clinic_id uuid;
BEGIN
  IF NOT (public.is_super_admin() OR public.can_manage_org(p_org_id)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  FOR v_clinic_id IN SELECT id FROM public.clinics WHERE organization_id = p_org_id LOOP
    PERFORM public.delete_clinic_cascade(v_clinic_id);
  END LOOP;

  FOR v_user_id IN SELECT id FROM public.org_users WHERE organization_id = p_org_id LOOP
    DELETE FROM auth.users WHERE id = v_user_id;
  END LOOP;

  DELETE FROM public.organizations WHERE id = p_org_id;
END;
$function$;

create or replace function public.create_clinic_with_owner(p_clinic_name text, p_plan text, p_organization_id uuid, p_owner_name text, p_owner_email text, p_owner_password text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE v_clinic_id uuid; v_user_id uuid;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    IF NOT public.can_manage_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  ELSE
    IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  END IF;
  INSERT INTO public.clinics (name, plan, organization_id) VALUES (p_clinic_name, p_plan, p_organization_id) RETURNING id INTO v_clinic_id;
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
$function$;

create or replace function public.create_clinic_with_owner(p_clinic_name text, p_plan text, p_organization_id uuid, p_owner_name text, p_owner_email text, p_owner_password text, p_owner_role text, p_category text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE v_clinic_id uuid; v_user_id uuid;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    IF NOT public.can_manage_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  ELSE
    IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  END IF;
  INSERT INTO public.clinics (name, plan, organization_id, category) VALUES (p_clinic_name, p_plan, p_organization_id, p_category) RETURNING id INTO v_clinic_id;
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
$function$;

-- Sem consumidores restantes (verificado: 0 policies e 0 outras funções citam is_admin()).
drop function public.is_admin();

-- Reforça o fechamento do anon nas 4 (o sweep já passou, mas CREATE OR REPLACE acima preservou a ACL).
revoke all on function public.create_org_with_owner(text,text,text,text,text,text) from public, anon;
revoke all on function public.delete_organization_cascade(uuid) from public, anon;
revoke all on function public.create_clinic_with_owner(text,text,uuid,text,text,text) from public, anon;
revoke all on function public.create_clinic_with_owner(text,text,uuid,text,text,text,text,text) from public, anon;
