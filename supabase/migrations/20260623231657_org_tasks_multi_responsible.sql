-- 20260623231657_org_tasks_multi_responsible
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.org_tasks ADD COLUMN IF NOT EXISTS responsible_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE public.org_tasks
  SET responsible_ids = ARRAY[responsible_id]
  WHERE responsible_id IS NOT NULL AND responsible_ids = '{}';

ALTER TABLE public.org_tasks DROP COLUMN IF EXISTS responsible_id;
