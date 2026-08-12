-- 20260514192258_fix_stage_transition_rules_rls_for_clinic_users
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove a policy antiga restritiva
DROP POLICY IF EXISTS "Enable all for super admins" ON public.stage_transition_rules;
DROP POLICY IF EXISTS "Enable read for authenticated users" ON public.stage_transition_rules;

-- Policy nova: qualquer usuário da clínica pode tudo (mesmo padrão de ai_config)
CREATE POLICY "stage_transition_rules_all" ON public.stage_transition_rules
  FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE id = auth.uid()
    )
    OR is_admin()
  )
  WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE id = auth.uid()
    )
    OR is_admin()
  );
