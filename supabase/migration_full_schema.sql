-- ============================================
-- SCHEMA SAAS MULTI-TENANT — CLÍNICAS MÉDICAS
-- Todas as 5 fases em um único script
-- Projeto: yzpclhuifquhfqpiwysh
-- ============================================

-- ============================================
-- FASE 1: CORE (clinics, users)
-- ============================================

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

-- ============================================
-- FASE 2: NEGÓCIO (doctors, patients, leads, funnel_stages)
-- ============================================

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

-- ============================================
-- FASE 3: OPERACIONAL (appointments, medical_records, financial_transactions)
-- ============================================

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  date date NOT NULL,
  time time NOT NULL,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'confirmado', 'realizado', 'cancelado', 'faltou')),
  source text DEFAULT 'manual' CHECK (source IN ('ia', 'manual', 'site')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_appointments_clinic_id ON public.appointments(clinic_id);
CREATE INDEX idx_appointments_doctor_id ON public.appointments(doctor_id);
CREATE INDEX idx_appointments_patient_id ON public.appointments(patient_id);
CREATE INDEX idx_appointments_date ON public.appointments(date);

CREATE TABLE public.medical_records (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'consulta' CHECK (type IN ('consulta', 'retorno', 'exame', 'procedimento')),
  description text,
  diagnosis text,
  prescription text,
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_medical_records_clinic_id ON public.medical_records(clinic_id);
CREATE INDEX idx_medical_records_patient_id ON public.medical_records(patient_id);
CREATE INDEX idx_medical_records_doctor_id ON public.medical_records(doctor_id);

CREATE TABLE public.financial_transactions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('receita', 'despesa')),
  category text,
  amount numeric NOT NULL DEFAULT 0,
  description text,
  payment_method text CHECK (payment_method IN ('pix', 'cartao', 'dinheiro', 'plano')),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pago', 'pendente', 'cancelado')),
  date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_clinic_id ON public.financial_transactions(clinic_id);
CREATE INDEX idx_financial_date ON public.financial_transactions(date);

-- ============================================
-- FASE 4: INTEGRAÇÕES (whatsapp, chat, ai_config)
-- ============================================

CREATE TABLE public.whatsapp_instances (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  api_url text NOT NULL,
  api_token text NOT NULL,
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'qr_pending')),
  connected_at timestamptz
);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender text NOT NULL DEFAULT 'system' CHECK (sender IN ('user', 'ai', 'system')),
  content text NOT NULL,
  phone text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_clinic_id ON public.chat_messages(clinic_id);
CREATE INDEX idx_chat_messages_lead_id ON public.chat_messages(lead_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at DESC);

CREATE TABLE public.ai_config (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  tone int NOT NULL DEFAULT 70 CHECK (tone >= 0 AND tone <= 100),
  response_style text NOT NULL DEFAULT 'cordial' CHECK (response_style IN ('tecnica', 'objetiva', 'cordial')),
  response_speed text NOT NULL DEFAULT 'instantanea' CHECK (response_speed IN ('instantanea', 'cadenciada')),
  bio_text text DEFAULT 'Olá! Sou a assistente IA da clínica. Estou aqui para ajudá-lo com agendamentos e dúvidas gerais.',
  auto_schedule boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- FASE 5: RLS + SEED
-- ============================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE public.clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funnel_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_config ENABLE ROW LEVEL SECURITY;

-- Policies: isolamento por clinic_id via tabela users
CREATE POLICY "clinics_select" ON public.clinics FOR SELECT
  USING (id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "users_select" ON public.users FOR SELECT
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "doctors_all" ON public.doctors FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "patients_all" ON public.patients FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "leads_all" ON public.leads FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "funnel_stages_all" ON public.funnel_stages FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "appointments_all" ON public.appointments FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "medical_records_all" ON public.medical_records FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

-- Médico vê apenas seus próprios registros
CREATE POLICY "medical_records_doctor_isolation" ON public.medical_records FOR SELECT
  USING (
    doctor_id IN (SELECT d.id FROM public.doctors d WHERE d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('gestor', 'secretaria'))
  );

-- Médico vê apenas sua própria agenda
CREATE POLICY "appointments_doctor_isolation" ON public.appointments FOR SELECT
  USING (
    doctor_id IN (SELECT d.id FROM public.doctors d WHERE d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('gestor', 'secretaria'))
  );

CREATE POLICY "financial_all" ON public.financial_transactions FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'gestor'));

CREATE POLICY "whatsapp_all" ON public.whatsapp_instances FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "chat_messages_all" ON public.chat_messages FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "ai_config_all" ON public.ai_config FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

-- Comentários nas tabelas
COMMENT ON TABLE public.clinics IS 'Tenants do SaaS - cada clínica é um tenant isolado';
COMMENT ON TABLE public.users IS 'Funcionários vinculados a uma clínica (gestor, medico, secretaria)';
COMMENT ON TABLE public.doctors IS 'Profissionais de saúde com CRM/CRO';
COMMENT ON TABLE public.patients IS 'Pacientes reais com prontuário';
COMMENT ON TABLE public.leads IS 'Dados de prospecção (não são pacientes)';
COMMENT ON TABLE public.funnel_stages IS 'Etapas do funil de leads (configurável por clínica)';
COMMENT ON TABLE public.appointments IS 'Agendamentos de consultas';
COMMENT ON TABLE public.medical_records IS 'Prontuário e histórico clínico';
COMMENT ON TABLE public.financial_transactions IS 'Transações financeiras (receitas e despesas)';
COMMENT ON TABLE public.whatsapp_instances IS 'Instâncias UaZapi conectadas';
COMMENT ON TABLE public.chat_messages IS 'Histórico de conversas WhatsApp (auditoria)';
COMMENT ON TABLE public.ai_config IS 'Configurações da Assistente IA por clínica';
