-- Vincular tarefa a um cliente (clinica) da organizacao. Opcional.
ALTER TABLE public.org_tasks
  ADD COLUMN IF NOT EXISTS clinic_id uuid REFERENCES public.clinics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_tasks_clinic ON public.org_tasks(clinic_id);
