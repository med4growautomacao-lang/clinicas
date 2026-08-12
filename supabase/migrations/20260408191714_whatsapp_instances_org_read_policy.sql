-- 20260408191714_whatsapp_instances_org_read_policy
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE POLICY "whatsapp_instances_org_read"
ON public.whatsapp_instances
FOR SELECT
USING (
  clinic_id IN (
    SELECT c.id FROM clinics c
    INNER JOIN org_users ou ON ou.organization_id = c.organization_id
    WHERE ou.user_id = auth.uid()
      AND ou.role IN ('org_admin', 'org_owner')
  )
);
