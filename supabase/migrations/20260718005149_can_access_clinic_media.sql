-- 20260718005149_can_access_clinic_media
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.can_access_clinic_media(p_clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.id = auth.uid() AND cu.clinic_id = p_clinic_id
    )
    OR EXISTS (
      SELECT 1 FROM public.org_users ou
      JOIN public.clinics c ON c.organization_id = ou.organization_id
      WHERE ou.user_id = auth.uid() AND c.id = p_clinic_id
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_clinic_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_clinic_media(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_access_clinic_media(uuid) IS
  'Fonte única de acesso à mídia da conversa (chat-media). Usada pela edge chat-media-sign. Espelha is_super_admin ∨ clinic_users ∨ org_users→clinics.';
