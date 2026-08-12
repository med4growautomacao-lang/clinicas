-- 20260507000720_fase1_etapa1_volatile_to_stable
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.is_clinic_active(p_clinic_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinics c
    LEFT JOIN public.organizations o ON c.organization_id = o.id
    WHERE c.id = p_clinic_id
      AND c.is_active = true
      AND (o.id IS NULL OR o.is_active = true)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.org_users
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role = 'org_owner'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_org_access(org_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.org_users
    WHERE organization_id = org_id
      AND user_id = auth.uid()
  );
END;
$$;
