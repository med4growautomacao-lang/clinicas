-- Bloqueia acesso de clinic_users a clínicas desativadas via RLS.
-- Reutiliza a função is_clinic_active(clinic_id) já existente, que retorna true
-- somente quando a clínica E sua organização estão ativas.
--
-- Estratégia: em cada policy que dá acesso via clinic_users.id = auth.uid(),
-- envolver essa condição com AND is_clinic_active(clinic_id).
-- Caminhos para org-managers (org_users JOIN clinics) e is_admin() permanecem
-- intactos: managers e super-admins ainda conseguem operar para reativar/auditar.

-- ============================================================================
-- TABELA: clinics (auto-acesso de clinic_users)
-- ============================================================================
DROP POLICY IF EXISTS "clinics_select" ON public.clinics;
CREATE POLICY "clinics_select" ON public.clinics
  FOR SELECT
  USING (
    id IN (SELECT u.clinic_id FROM public.clinic_users u WHERE u.id = auth.uid())
    AND is_active = true
  );

DROP POLICY IF EXISTS "clinics_all" ON public.clinics;
CREATE POLICY "clinics_all" ON public.clinics
  FOR ALL
  USING (
    (
      id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND is_active = true
    )
    OR public.is_admin()
  );

-- ============================================================================
-- TABELA: clinic_users
-- Bloqueia auto-leitura quando a clínica está desativada.
-- ============================================================================
DROP POLICY IF EXISTS "users_all" ON public.clinic_users;
CREATE POLICY "users_all" ON public.clinic_users
  FOR ALL
  USING (
    (
      (id = auth.uid() OR clinic_id = public.get_my_clinic_id())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "users_select_v2" ON public.clinic_users;
CREATE POLICY "users_select_v2" ON public.clinic_users
  FOR SELECT
  USING (
    (id = auth.uid() OR clinic_id = public.get_my_clinic_id())
    AND public.is_clinic_active(clinic_id)
  );

-- ============================================================================
-- TABELA: ai_config
-- ============================================================================
DROP POLICY IF EXISTS "ai_config_all" ON public.ai_config;
CREATE POLICY "ai_config_all" ON public.ai_config
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

-- ============================================================================
-- TABELA: appointments
-- ============================================================================
DROP POLICY IF EXISTS "appointments_all" ON public.appointments;
CREATE POLICY "appointments_all" ON public.appointments
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

-- ============================================================================
-- TABELA: automation_logs
-- ============================================================================
DROP POLICY IF EXISTS "automation_logs_all" ON public.automation_logs;
CREATE POLICY "automation_logs_all" ON public.automation_logs
  FOR ALL
  USING (
    clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
    AND public.is_clinic_active(clinic_id)
  );

-- ============================================================================
-- TABELA: clinic_enc_keys
-- ============================================================================
DROP POLICY IF EXISTS "clinic_member_read" ON public.clinic_enc_keys;
CREATE POLICY "clinic_member_read" ON public.clinic_enc_keys
  FOR SELECT
  USING (
    clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
    AND public.is_clinic_active(clinic_id)
  );

DROP POLICY IF EXISTS "clinic_member_insert" ON public.clinic_enc_keys;
CREATE POLICY "clinic_member_insert" ON public.clinic_enc_keys
  FOR INSERT
  WITH CHECK (
    clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
    AND public.is_clinic_active(clinic_id)
  );

-- ============================================================================
-- TABELA: conversions (combina clinic_users + org_users)
-- clinic_users bloqueado se inativa; org_users continua acessando.
-- ============================================================================
DROP POLICY IF EXISTS "clinic_conversions_access" ON public.conversions;
CREATE POLICY "clinic_conversions_access" ON public.conversions
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR
    clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TABELA: exam_requests (combina clinic_users + org_users)
-- ============================================================================
DROP POLICY IF EXISTS "exam_requests_access" ON public.exam_requests;
CREATE POLICY "exam_requests_access" ON public.exam_requests
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR
    clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TABELA: financial_transactions (duas policies)
-- ============================================================================
DROP POLICY IF EXISTS "financial_transactions_all" ON public.financial_transactions;
CREATE POLICY "financial_transactions_all" ON public.financial_transactions
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "financial_gestor_only" ON public.financial_transactions;
CREATE POLICY "financial_gestor_only" ON public.financial_transactions
  FOR ALL
  USING (
    clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
    AND public.is_clinic_active(clinic_id)
    AND EXISTS (
      SELECT 1 FROM public.clinic_users
      WHERE clinic_users.id = auth.uid() AND clinic_users.role = 'gestor'
    )
  );

-- ============================================================================
-- TABELA: funnel_stages (apenas funnel_stages_org_access — funnel_stages_all já tem)
-- A policy _org_access é para org-managers; mantida sem filtro pois eles devem
-- continuar enxergando para gerenciar/reativar.
-- (Sem mudanças aqui.)
-- ============================================================================

-- ============================================================================
-- TABELA: lead_stage_history
-- ============================================================================
DROP POLICY IF EXISTS "Enable all access for clinic users on lead stage history" ON public.lead_stage_history;
CREATE POLICY "Enable all access for clinic users on lead stage history" ON public.lead_stage_history
  FOR ALL
  USING (
    clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
    AND public.is_clinic_active(clinic_id)
  );

-- ============================================================================
-- TABELA: medical_records
-- ============================================================================
DROP POLICY IF EXISTS "medical_records_all" ON public.medical_records;
CREATE POLICY "medical_records_all" ON public.medical_records
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

-- ============================================================================
-- TABELA: patients
-- ============================================================================
DROP POLICY IF EXISTS "patients_all" ON public.patients;
CREATE POLICY "patients_all" ON public.patients
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

-- ============================================================================
-- TABELA: pending_clinic_users (gestor_manage_pending — org_admin_manage_pending mantida)
-- ============================================================================
DROP POLICY IF EXISTS "gestor_manage_pending" ON public.pending_clinic_users;
CREATE POLICY "gestor_manage_pending" ON public.pending_clinic_users
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id = pending_clinic_users.clinic_id
        AND cu.role IN ('gestor', 'medico_gestor')
    )
    AND public.is_clinic_active(pending_clinic_users.clinic_id)
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id = pending_clinic_users.clinic_id
        AND cu.role IN ('gestor', 'medico_gestor')
    )
    AND public.is_clinic_active(pending_clinic_users.clinic_id)
  );

-- ============================================================================
-- TABELA: prescriptions (clinic_users + org_users)
-- ============================================================================
DROP POLICY IF EXISTS "prescriptions_access" ON public.prescriptions;
CREATE POLICY "prescriptions_access" ON public.prescriptions
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR
    clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TABELA: protocols (clinic_users + org_users)
-- ============================================================================
DROP POLICY IF EXISTS "protocols_access" ON public.protocols;
CREATE POLICY "protocols_access" ON public.protocols
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR
    clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TABELA: stage_transition_rules
-- ============================================================================
DROP POLICY IF EXISTS "stage_transition_rules_all" ON public.stage_transition_rules;
CREATE POLICY "stage_transition_rules_all" ON public.stage_transition_rules
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  )
  WITH CHECK (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

-- ============================================================================
-- TABELA: whatsapp_instances (apenas whatsapp_all; whatsapp_instances_org_read mantida)
-- ============================================================================
DROP POLICY IF EXISTS "whatsapp_all" ON public.whatsapp_instances;
CREATE POLICY "whatsapp_all" ON public.whatsapp_instances
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );
