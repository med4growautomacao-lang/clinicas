-- 20260407160447_create_med4grow_org_and_owner
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $$
DECLARE
  v_org_id uuid;
  v_user_id uuid := gen_random_uuid();
BEGIN

  -- 1. Criar organização Med4grow
  INSERT INTO public.organizations (name, plan)
  VALUES ('Med4grow', 'enterprise')
  RETURNING id INTO v_org_id;

  -- 2. Vincular as clínicas reais à organização
  UPDATE public.clinics
  SET organization_id = v_org_id
  WHERE id IN (
    'd62ae030-7a87-4a9d-9dcf-fb2e78dd7ba2', -- Minha Clínica
    '2c9c4e85-df66-41f6-b345-8b7ec94f0605'  -- Vaz
  );

  -- 3. Criar usuário no auth.users
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    'pedrohnaves1@gmail.com',
    crypt('teste123', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '', '', '', ''
  );

  -- 4. Criar identity para login por email
  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(),
    v_user_id,
    v_user_id::text,
    jsonb_build_object('sub', v_user_id::text, 'email', 'pedrohnaves1@gmail.com'),
    'email',
    now(), now(), now()
  );

  -- 5. Criar org_user como org_owner
  INSERT INTO public.org_users (user_id, organization_id, role, full_name, email)
  VALUES (v_user_id, v_org_id, 'org_owner', 'Pedro Naves', 'pedrohnaves1@gmail.com');

END $$;
