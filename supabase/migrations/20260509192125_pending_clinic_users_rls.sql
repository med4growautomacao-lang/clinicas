-- 20260509192125_pending_clinic_users_rls
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE pending_clinic_users ENABLE ROW LEVEL SECURITY;

-- Org admins/owners podem inserir e deletar pré-cadastros
CREATE POLICY "org_admin_manage_pending" ON pending_clinic_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM org_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.role IN ('org_owner', 'org_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM org_users ou
      WHERE ou.user_id = auth.uid()
        AND ou.role IN ('org_owner', 'org_admin')
    )
  );

-- Gestores da clínica também podem gerenciar pré-cadastros da sua clínica
CREATE POLICY "gestor_manage_pending" ON pending_clinic_users
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id = pending_clinic_users.clinic_id
        AND cu.role IN ('gestor', 'medico_gestor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id = pending_clinic_users.clinic_id
        AND cu.role IN ('gestor', 'medico_gestor')
    )
  );
