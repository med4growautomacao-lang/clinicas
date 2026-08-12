-- 20260408150303_org_users_self_select_policy
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE POLICY "org_users_self_select"
ON org_users
FOR SELECT
USING (user_id = auth.uid());
