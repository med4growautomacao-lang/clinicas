-- Catalogo de Produtos: catalogo generico e personalizavel por clinica.
-- Espelha o modelo de `protocols` (mesma RLS) e adiciona:
--   unit        -> unidade de medida (metro, m2, un, hora, kg...)
--   unit_price  -> valor por unidade (ex: valor por metro)
--   attributes  -> campos extras livres [{label, value, unit}] (fio, malha, material, comprimento...)
-- Usado no Kanban (etapa Orcamento) para calcular o total automaticamente
-- (quantidade x unit_price). No modelo atual NAO persistimos itens: o modal grava
-- apenas o valor (leads.estimated_value) + um resumo em texto (tickets.notes).

CREATE TABLE IF NOT EXISTS public.products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  unit        text NOT NULL DEFAULT 'un',
  unit_price  numeric NOT NULL DEFAULT 0,
  attributes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_clinic_idx ON public.products (clinic_id);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- RLS identica a protocols_access: membro da clinica (ativa) OU org_user da organizacao OU admin.
DROP POLICY IF EXISTS products_access ON public.products;
CREATE POLICY products_access ON public.products
  AS PERMISSIVE FOR ALL TO public
  USING (
    (((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id))
     OR (clinic_id IN (SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid())))
     OR is_clinic_admin(clinic_id))
  )
  WITH CHECK (
    (((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id))
     OR (clinic_id IN (SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid())))
     OR is_clinic_admin(clinic_id))
  );
