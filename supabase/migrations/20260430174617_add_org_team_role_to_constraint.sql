-- 20260430174617_add_org_team_role_to_constraint
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.org_users DROP CONSTRAINT org_users_role_check;
ALTER TABLE public.org_users ADD CONSTRAINT org_users_role_check 
  CHECK (role = ANY (ARRAY['org_owner'::text, 'org_admin'::text, 'org_team'::text]));
