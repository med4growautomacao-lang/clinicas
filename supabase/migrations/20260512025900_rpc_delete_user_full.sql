-- 20260512025900_rpc_delete_user_full
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove um usuário completamente: clinic_users, org_users, auth.users, prontuario_passwords
-- Mantém appointments e medical_records (histórico preservado)
CREATE OR REPLACE FUNCTION public.delete_user_full(
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_clinic_users_deleted int := 0;
  v_org_users_deleted int := 0;
  v_pending_deleted int := 0;
  v_pin_deleted int := 0;
  v_auth_deleted int := 0;
  v_doctor_unlinked int := 0;
  v_email text;
BEGIN
  -- Pega o email pra também limpar pre-cadastros
  SELECT email INTO v_email FROM auth.users WHERE id = p_user_id;

  -- 1. Remove de clinic_users
  DELETE FROM clinic_users WHERE id = p_user_id;
  GET DIAGNOSTICS v_clinic_users_deleted = ROW_COUNT;

  -- 2. Remove de org_users
  DELETE FROM org_users WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_org_users_deleted = ROW_COUNT;

  -- 3. Remove pré-cadastro com mesmo email (se houver)
  IF v_email IS NOT NULL THEN
    DELETE FROM pending_clinic_users WHERE LOWER(email) = LOWER(v_email);
    GET DIAGNOSTICS v_pending_deleted = ROW_COUNT;
  END IF;

  -- 4. Remove senha do prontuário
  DELETE FROM prontuario_passwords WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_pin_deleted = ROW_COUNT;

  -- 5. Desvincula doctors (mantém o registro, só remove o user_id)
  UPDATE doctors SET user_id = NULL WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_doctor_unlinked = ROW_COUNT;

  -- 6. Remove de auth.users (precisa de service_role)
  DELETE FROM auth.users WHERE id = p_user_id;
  GET DIAGNOSTICS v_auth_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'email', v_email,
    'deleted', jsonb_build_object(
      'clinic_users', v_clinic_users_deleted,
      'org_users', v_org_users_deleted,
      'pending_clinic_users', v_pending_deleted,
      'prontuario_passwords', v_pin_deleted,
      'auth_users', v_auth_deleted
    ),
    'unlinked', jsonb_build_object(
      'doctors', v_doctor_unlinked
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_full(uuid) TO service_role;
