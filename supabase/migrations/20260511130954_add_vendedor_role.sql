-- 20260511130954_add_vendedor_role
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE clinic_users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE clinic_users ADD CONSTRAINT users_role_check
  CHECK (role IN ('gestor', 'medico', 'medico_gestor', 'secretaria', 'vendedor', 'super-admin'));
