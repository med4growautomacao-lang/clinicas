-- Status de 3 estados para as tarefas: 'todo' | 'doing' | 'done'.
-- is_done/done_at sao mantidos em sincronia (done == status 'done') p/ compatibilidade.
ALTER TABLE public.org_tasks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'todo'
  CHECK (status IN ('todo', 'doing', 'done'));

UPDATE public.org_tasks SET status = 'done' WHERE is_done = true AND status <> 'done';
