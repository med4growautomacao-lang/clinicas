-- 20260311203304_phase_5_rls_policies
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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

-- =========================================
-- POLICIES: Isolamento por clinic_id
-- =========================================

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

-- =========================================
-- POLICIES: Médico vê apenas seus registros
-- =========================================

CREATE POLICY "medical_records_doctor_isolation" ON public.medical_records FOR SELECT
  USING (
    doctor_id IN (SELECT d.id FROM public.doctors d WHERE d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('gestor', 'secretaria'))
  );

CREATE POLICY "appointments_doctor_isolation" ON public.appointments FOR SELECT
  USING (
    doctor_id IN (SELECT d.id FROM public.doctors d WHERE d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('gestor', 'secretaria'))
  );

-- =========================================
-- POLICIES: Financeiro só para Gestor
-- =========================================

CREATE POLICY "financial_gestor_only" ON public.financial_transactions FOR ALL
  USING (
    clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'gestor')
  );

-- =========================================
-- POLICIES: Integrações
-- =========================================

CREATE POLICY "whatsapp_all" ON public.whatsapp_instances FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "chat_messages_all" ON public.chat_messages FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "ai_config_all" ON public.ai_config FOR ALL
  USING (clinic_id IN (SELECT clinic_id FROM public.users WHERE id = auth.uid()));
