-- Aba "Tarefas" do painel de organizacoes (matriz de Eisenhower)
-- Tarefas a nivel de organizacao, com responsavel (org_users), prazo e status.

CREATE TABLE IF NOT EXISTS public.org_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  is_urgent boolean NOT NULL DEFAULT false,
  is_important boolean NOT NULL DEFAULT false,
  responsible_id uuid REFERENCES public.org_users(id) ON DELETE SET NULL,
  due_date date,
  is_done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_tasks_org ON public.org_tasks(organization_id);

ALTER TABLE public.org_tasks ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer membro da organizacao
DROP POLICY IF EXISTS "org members read tasks" ON public.org_tasks;
CREATE POLICY "org members read tasks" ON public.org_tasks FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.org_users WHERE user_id = auth.uid()
  ));

-- Escrita: somente owner/admin (reutiliza helper existente can_manage_org)
DROP POLICY IF EXISTS "org managers manage tasks" ON public.org_tasks;
CREATE POLICY "org managers manage tasks" ON public.org_tasks FOR ALL
  USING (public.can_manage_org(organization_id))
  WITH CHECK (public.can_manage_org(organization_id));
