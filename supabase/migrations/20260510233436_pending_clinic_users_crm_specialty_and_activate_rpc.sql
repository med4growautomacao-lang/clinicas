-- 20260510233436_pending_clinic_users_crm_specialty_and_activate_rpc
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adiciona campos de médico na tabela de pré-cadastro
ALTER TABLE public.pending_clinic_users
  ADD COLUMN IF NOT EXISTS crm text,
  ADD COLUMN IF NOT EXISTS specialty text;

-- RPC para ativar médico pré-cadastrado (chamada logo após signUp)
-- SECURITY DEFINER para ignorar RLS ao escrever em clinic_users e doctors
CREATE OR REPLACE FUNCTION public.activate_pending_medico(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  pending public.pending_clinic_users%ROWTYPE;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Não autenticado');
  END IF;

  SELECT * INTO pending
  FROM public.pending_clinic_users
  WHERE LOWER(email) = LOWER(p_email)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Email não pré-cadastrado');
  END IF;

  -- Cria registro em clinic_users
  INSERT INTO public.clinic_users (id, clinic_id, full_name, email, role, created_at)
  VALUES (v_user_id, pending.clinic_id, pending.full_name, p_email, pending.role, NOW())
  ON CONFLICT (id) DO NOTHING;

  -- Linka o registro de doctors criado pelo admin (user_id NULL → novo user)
  UPDATE public.doctors
  SET user_id = v_user_id
  WHERE user_id IS NULL
    AND clinic_id = pending.clinic_id
    AND LOWER(name) = LOWER(pending.full_name);

  DELETE FROM public.pending_clinic_users WHERE id = pending.id;

  RETURN jsonb_build_object('ok', true, 'clinic_id', pending.clinic_id, 'role', pending.role);
END;
$$;

-- Atualiza a trigger existente para também criar o registro doctors
-- (cobre o caso em que confirmação de email ESTÁ habilitada)
CREATE OR REPLACE FUNCTION public.fn_activate_pending_clinic_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pending public.pending_clinic_users%ROWTYPE;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL) THEN
    SELECT * INTO pending
    FROM public.pending_clinic_users
    WHERE LOWER(email) = LOWER(NEW.email)
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.clinic_users (id, clinic_id, full_name, email, role, created_at)
      VALUES (NEW.id, pending.clinic_id, pending.full_name, NEW.email, pending.role, NOW())
      ON CONFLICT (id) DO NOTHING;

      UPDATE public.doctors
      SET user_id = NEW.id
      WHERE user_id IS NULL
        AND clinic_id = pending.clinic_id
        AND LOWER(name) = LOWER(pending.full_name);

      DELETE FROM public.pending_clinic_users WHERE id = pending.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
