-- 20260623234203_org_tasks_status
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.org_tasks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo'
  CHECK (status IN ('todo', 'doing', 'done'));

UPDATE public.org_tasks SET status = 'done' WHERE is_done = true AND status <> 'done';
