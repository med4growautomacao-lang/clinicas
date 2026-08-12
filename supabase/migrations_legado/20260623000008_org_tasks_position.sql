-- Ordenacao manual das tarefas dentro de cada quadrante (drag & drop).
ALTER TABLE public.org_tasks ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
