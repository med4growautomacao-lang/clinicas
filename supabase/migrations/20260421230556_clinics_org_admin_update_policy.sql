-- 20260421230556_clinics_org_admin_update_policy
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Allow org_admin users to update clinics that belong to their organization
CREATE POLICY "clinics_org_update" ON clinics
  FOR UPDATE
  USING (
    organization_id IN (
      SELECT org_users.organization_id
      FROM org_users
      WHERE org_users.user_id = auth.uid()
    )
  );
