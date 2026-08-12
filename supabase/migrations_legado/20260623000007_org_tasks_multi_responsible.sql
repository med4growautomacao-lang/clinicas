-- Permite multiplos responsaveis por tarefa (array de org_users.id).
-- Substitui a coluna responsible_id (FK unica) por responsible_ids uuid[].

ALTER TABLE public.org_tasks ADD COLUMN IF NOT EXISTS responsible_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE public.org_tasks
  SET responsible_ids = ARRAY[responsible_id]
  WHERE responsible_id IS NOT NULL AND responsible_ids = '{}';

ALTER TABLE public.org_tasks DROP COLUMN IF EXISTS responsible_id;
