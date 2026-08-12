-- 20260623233248_org_tasks_position
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.org_tasks ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
