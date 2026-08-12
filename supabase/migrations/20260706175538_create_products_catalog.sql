-- 20260706175538_create_products_catalog
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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
