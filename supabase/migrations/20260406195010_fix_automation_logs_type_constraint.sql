-- 20260406195010_fix_automation_logs_type_constraint
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adiciona 'forms_welcome' ao CHECK constraint de automation_logs.type
ALTER TABLE public.automation_logs
  DROP CONSTRAINT IF EXISTS automation_logs_type_check;

ALTER TABLE public.automation_logs
  ADD CONSTRAINT automation_logs_type_check
  CHECK (type = ANY (ARRAY['followup'::text, 'handoff'::text, 'confirm'::text, 'forms_welcome'::text]));
