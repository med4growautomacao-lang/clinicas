-- 20260430151856_create_clinic_members
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE public.clinic_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  org_user_id uuid NOT NULL,
  function text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(clinic_id, org_user_id, function)
);

-- Migra dados existentes
INSERT INTO public.clinic_members (clinic_id, org_user_id, function)
SELECT id, gestor_trafego_id, 'gestor_trafego'
FROM public.clinics
WHERE gestor_trafego_id IS NOT NULL;

INSERT INTO public.clinic_members (clinic_id, org_user_id, function)
SELECT id, admin_responsavel_id, 'admin_responsavel'
FROM public.clinics
WHERE admin_responsavel_id IS NOT NULL;

-- Remove colunas antigas
ALTER TABLE public.clinics
  DROP COLUMN IF EXISTS gestor_trafego_id,
  DROP COLUMN IF EXISTS admin_responsavel_id;
