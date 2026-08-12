-- 20260511191358_expand_pending_clinic_users_role_check
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE pending_clinic_users DROP CONSTRAINT IF EXISTS pending_clinic_users_role_check;

ALTER TABLE pending_clinic_users
  ADD CONSTRAINT pending_clinic_users_role_check
  CHECK (role IN ('gestor', 'medico', 'medico_gestor', 'secretaria', 'vendedor'));
