-- 20260728023858_20260728023656_fase7c_prompt_templates_authenticated_only
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- FASE 7c (hardening): a policy prompt_templates_select_all era USING true para PUBLIC (inclui
-- anon), expondo os prompts de SISTEMA COMPARTILHADOS (tom, etapas, quando usar cada tool = os
-- guardrails do agente) a qualquer portador da anon key — superficie de jailbreak/prompt-injection.
-- Restringe a authenticated. Rastreado (workflow + verificacao): o n8n le via v_clinic_ai_prompt
-- sob service_role (bypassa RLS) e o front admin le autenticado; assistant_ro NAO le prompt_templates
-- (sem grant e sem policy). Só anon perde acesso. Escrita segue travada em prompt_templates_admin_write.
drop policy if exists prompt_templates_select_all on public.prompt_templates;
create policy prompt_templates_select_all
  on public.prompt_templates
  for select
  to authenticated
  using (true);
