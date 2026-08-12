-- 20260421231310_org_admin_funnel_leads_rls
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Org admins podem gerenciar funnel_stages das clínicas da sua organização
CREATE POLICY "funnel_stages_org_access" ON funnel_stages
  FOR ALL
  USING (
    clinic_id IN (
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );

-- Org admins podem gerenciar leads (incluindo alterar etapa) das clínicas da sua organização
CREATE POLICY "leads_org_access" ON leads
  FOR ALL
  USING (
    clinic_id IN (
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );
