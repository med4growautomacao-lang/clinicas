-- Banco de imagens do orçamento por clínica. As marcadas (send_by_default) são enviadas
-- por WhatsApp junto com o orçamento. Arquivos ficam no bucket público 'quotes'.
CREATE TABLE IF NOT EXISTS public.quote_images (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  url             text NOT NULL,
  path            text NOT NULL,
  name            text,
  send_by_default boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_images_clinic_idx ON public.quote_images (clinic_id);

ALTER TABLE public.quote_images ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_images_access ON public.quote_images;
CREATE POLICY quote_images_access ON public.quote_images
  AS PERMISSIVE FOR ALL TO public
  USING (
    (((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id))
     OR (clinic_id IN (SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid())))
     OR is_clinic_admin(clinic_id))
  )
  WITH CHECK (
    (((clinic_id IN (SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)))
     OR (clinic_id IN (SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid())))
     OR is_clinic_admin(clinic_id)
  );
