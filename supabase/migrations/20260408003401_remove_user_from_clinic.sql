-- 20260408003401_remove_user_from_clinic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.remove_user_from_clinic(p_user_id uuid, p_clinic_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.clinic_users
  WHERE user_id = p_user_id AND clinic_id = p_clinic_id;
END;
$$;
