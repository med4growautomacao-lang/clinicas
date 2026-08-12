-- 20260311203225_phase_3_appointments_records_finance
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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

COMMENT ON TABLE public.appointments IS 'Agendamentos de consultas';
COMMENT ON TABLE public.medical_records IS 'Prontuário e histórico clínico';
COMMENT ON TABLE public.financial_transactions IS 'Transações financeiras (receitas e despesas)';
