-- 20260430173751_fix_rls_helper_functions_table_reference
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Fix get_my_clinic_id: referenciava 'public.users' que não existe, deve ser 'public.clinic_users'
CREATE OR REPLACE FUNCTION public.get_my_clinic_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid();
$$;

-- Fix is_admin: mesma correção
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_users WHERE id = auth.uid() AND role = 'super-admin'
  ) OR EXISTS (
    SELECT 1 FROM public.org_users WHERE user_id = auth.uid()
  );
$$;
