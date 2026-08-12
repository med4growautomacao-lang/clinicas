-- 20260715125220_fix_clinic_creation_double_seed_funnel_stages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- BUG: criar clínica via create_clinic_with_owner duplicava as etapas do funil. O INSERT em
-- clinics já dispara o trigger on_clinic_created -> handle_new_clinic(), que semeia as etapas
-- (modelo ATUAL: ...Ganho/Faltou-Cancelou/Perdido). A RPC AINDA chamava seed_default_funnel_stages()
-- (modelo LEGADO: ...Conversão/Paciente/Atendimento Humano) -> ~21 etapas sobrepostas.
-- Fix: remover a chamada redundante das DUAS sobrecargas. O trigger é a única fonte de etapas.

CREATE OR REPLACE FUNCTION public.create_clinic_with_owner(
  p_clinic_name text, p_plan text, p_organization_id uuid, p_owner_name text, p_owner_email text, p_owner_password text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_clinic_id uuid; v_user_id uuid;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    IF NOT public.can_manage_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  ELSE
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  END IF;
  INSERT INTO public.clinics (name, plan, organization_id) VALUES (p_clinic_name, p_plan, p_organization_id) RETURNING id INTO v_clinic_id;
  -- Etapas do funil são semeadas pelo trigger on_clinic_created (handle_new_clinic). NÃO semear aqui.
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

CREATE OR REPLACE FUNCTION public.create_clinic_with_owner(
  p_clinic_name text, p_plan text, p_organization_id uuid, p_owner_name text, p_owner_email text, p_owner_password text, p_owner_role text, p_category text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_clinic_id uuid; v_user_id uuid;
BEGIN
  IF p_organization_id IS NOT NULL THEN
    IF NOT public.can_manage_org(p_organization_id) THEN RAISE EXCEPTION 'Access denied'; END IF;
  ELSE
    IF NOT public.is_admin() THEN RAISE EXCEPTION 'Access denied'; END IF;
  END IF;
  INSERT INTO public.clinics (name, plan, organization_id, category) VALUES (p_clinic_name, p_plan, p_organization_id, p_category) RETURNING id INTO v_clinic_id;
  -- Etapas do funil são semeadas pelo trigger on_clinic_created (handle_new_clinic). NÃO semear aqui.
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
