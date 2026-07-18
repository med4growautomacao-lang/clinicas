-- Rollback da 20260717000022 — restaura as policies ABERTAS anteriores.
-- ATENÇÃO: reabre o buraco (qualquer authenticated grava system_settings, inclui
-- o global_tracking_script injetado em todos os sites). Só reverter se algo
-- legítimo não-super-admin precisar gravar (e então preferir uma policy mais
-- específica em vez de reabrir tudo).
DROP POLICY IF EXISTS "system_settings_insert_super_admin" ON public.system_settings;
DROP POLICY IF EXISTS "system_settings_update_super_admin" ON public.system_settings;

CREATE POLICY "System settings can be inserted by authenticated users" ON public.system_settings
  FOR INSERT TO public
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "System settings can be updated by authenticated users" ON public.system_settings
  FOR UPDATE TO public
  USING (auth.role() = 'authenticated');
