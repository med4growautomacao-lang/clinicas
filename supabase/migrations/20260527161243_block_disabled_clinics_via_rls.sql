-- 20260527161243_block_disabled_clinics_via_rls
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- TABELA: clinics
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

-- TABELA: clinic_users
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

-- ai_config
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

-- appointments
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

-- automation_logs
DROP POLICY IF EXISTS "automation_logs_all" ON public.automation_logs;
CREATE POLICY "automation_logs_all" ON public.automation_logs
  FOR ALL
  USING (
    clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
    AND public.is_clinic_active(clinic_id)
  );

-- clinic_enc_keys
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

-- conversions
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

-- exam_requests
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

-- financial_transactions
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

-- lead_stage_history
DROP POLICY IF EXISTS "Enable all access for clinic users on lead stage history" ON public.lead_stage_history;
CREATE POLICY "Enable all access for clinic users on lead stage history" ON public.lead_stage_history
  FOR ALL
  USING (
    clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
    AND public.is_clinic_active(clinic_id)
  );

-- medical_records
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

-- patients
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

-- pending_clinic_users
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

-- prescriptions
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

-- protocols
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

-- stage_transition_rules
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

-- whatsapp_instances
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
