-- 20260718023958_system_settings_write_super_admin
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP POLICY IF EXISTS "System settings can be inserted by authenticated users" ON public.system_settings;
DROP POLICY IF EXISTS "System settings can be updated by authenticated users" ON public.system_settings;

CREATE POLICY "system_settings_insert_super_admin" ON public.system_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "system_settings_update_super_admin" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
