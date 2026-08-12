-- 20260311203207_phase_2_doctors_patients_leads_funnel
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE public.doctors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  specialty text,
  crm text,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('atendendo', 'pausa', 'offline')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_doctors_clinic_id ON public.doctors(clinic_id);
CREATE INDEX idx_doctors_user_id ON public.doctors(user_id);

CREATE TABLE public.patients (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  cpf text,
  birth_date date,
  gender text,
  weight text,
  height text,
  allergies text[],
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_patients_clinic_id ON public.patients(clinic_id);
CREATE INDEX idx_patients_phone ON public.patients(phone);

CREATE TABLE public.funnel_stages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  position int NOT NULL DEFAULT 0,
  color text DEFAULT 'bg-slate-500',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_funnel_stages_clinic_id ON public.funnel_stages(clinic_id);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  source text DEFAULT 'manual' CHECK (source IN ('facebook_ads', 'google', 'whatsapp', 'instagram', 'indicacao', 'site', 'manual')),
  stage_id uuid REFERENCES public.funnel_stages(id) ON DELETE SET NULL,
  estimated_value numeric DEFAULT 0,
  notes text,
  converted_patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_clinic_id ON public.leads(clinic_id);
CREATE INDEX idx_leads_stage_id ON public.leads(stage_id);
CREATE INDEX idx_leads_source ON public.leads(source);

COMMENT ON TABLE public.doctors IS 'Profissionais de saúde com CRM/CRO';
COMMENT ON TABLE public.patients IS 'Pacientes reais com prontuário';
COMMENT ON TABLE public.leads IS 'Dados de prospecção (não são pacientes)';
COMMENT ON TABLE public.funnel_stages IS 'Etapas do funil de leads (configurável por clínica)';
