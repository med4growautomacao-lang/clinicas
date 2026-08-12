-- 20260603150901_org_admin_manage_org_users
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP POLICY IF EXISTS "org_users_manage_policy" ON public.org_users;

CREATE POLICY "org_users_manage_policy" ON public.org_users
  FOR ALL
  USING (public.can_manage_org(organization_id))
  WITH CHECK (public.can_manage_org(organization_id));
