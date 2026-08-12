-- 20260423120350_doctors_org_admin_explicit_update
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adiciona políticas explícitas de SELECT e UPDATE para membros de org_users
-- na tabela doctors, via join com clinics. Isso é separado da doctors_all policy
-- (que usa is_admin()) e garante acesso mesmo se is_admin() tiver alguma inconsistência.

CREATE POLICY "doctors_org_admin_select" ON doctors FOR SELECT
  TO authenticated
  USING (
    clinic_id IN (
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );

CREATE POLICY "doctors_org_admin_update" ON doctors FOR UPDATE
  TO authenticated
  USING (
    clinic_id IN (
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  )
  WITH CHECK (
    clinic_id IN (
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );

CREATE POLICY "doctors_org_admin_insert" ON doctors FOR INSERT
  TO authenticated
  WITH CHECK (
    clinic_id IN (
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );

CREATE POLICY "doctors_org_admin_delete" ON doctors FOR DELETE
  TO authenticated
  USING (
    clinic_id IN (
      SELECT c.id FROM clinics c
      JOIN org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );
