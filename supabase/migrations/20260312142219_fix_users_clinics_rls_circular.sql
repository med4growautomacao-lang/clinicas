-- 20260312142219_fix_users_clinics_rls_circular
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Fix circular RLS on users table:
-- Old policy: clinic_id IN (SELECT clinic_id FROM users WHERE id = auth.uid())
-- This is circular because you need to read users to be able to read users.
-- New policy: simply allow the user to read their own row by matching auth.uid()
DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT
  USING (id = auth.uid() OR clinic_id IN (SELECT u.clinic_id FROM users u WHERE u.id = auth.uid()));

-- Fix clinics policy: allow reading the clinic the user belongs to
DROP POLICY IF EXISTS clinics_select ON clinics;
CREATE POLICY clinics_select ON clinics FOR SELECT
  USING (id IN (SELECT u.clinic_id FROM users u WHERE u.id = auth.uid()));
