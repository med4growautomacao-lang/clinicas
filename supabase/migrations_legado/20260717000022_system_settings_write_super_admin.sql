-- =============================================================================
-- FIX de segurança — escrita de system_settings restrita a super-admin
--
-- Antes (dívida pré-existente): as policies de INSERT/UPDATE de system_settings
-- eram `auth.role() = 'authenticated'` → QUALQUER usuário logado (de qualquer
-- clínica) podia sobrescrever qualquer chave. O pior caso é `global_tracking_script`
-- (servido pela edge site-script e injetado em TODOS os sites dos tenants →
-- stored XSS / supply-chain). Também deixava media_ai_config/ai_assistant_config
-- adulteráveis.
--
-- Fix: INSERT/UPDATE passam a exigir public.is_super_admin(). SELECT continua
-- público (a UI/edge leem config e tracking script; nenhum SEGREDO mora aqui —
-- chaves de API estão no Vault). Único escritor legítimo pelo app é o SuperAdmin
-- (useGlobalSystemSettings.updateSetting, telas AIAssistant/Variáveis) e as RPCs
-- SECURITY DEFINER (set_media_ai_config) — ambos super-admin. Edges gravam com
-- service role (bypassam RLS). Alinhado a rls-org-tenant-isolation-fix.
-- =============================================================================

DROP POLICY IF EXISTS "System settings can be inserted by authenticated users" ON public.system_settings;
DROP POLICY IF EXISTS "System settings can be updated by authenticated users" ON public.system_settings;

CREATE POLICY "system_settings_insert_super_admin" ON public.system_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY "system_settings_update_super_admin" ON public.system_settings
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
