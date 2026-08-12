-- 20260311203152_phase_1_core_clinics_users
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE public.clinics (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  cnpj text,
  phone text,
  address text,
  logo_url text,
  primary_color text DEFAULT '#0d9488',
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'enterprise')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('gestor', 'medico', 'secretaria')),
  full_name text NOT NULL,
  email text NOT NULL,
  avatar_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_clinic_id ON public.users(clinic_id);
CREATE INDEX idx_users_role ON public.users(role);

COMMENT ON TABLE public.clinics IS 'Tenants do SaaS - cada clínica é um tenant isolado';
COMMENT ON TABLE public.users IS 'Funcionários vinculados a uma clínica (gestor, medico, secretaria)';
