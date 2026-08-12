-- Corrige furo de isolamento multi-tenant.
--
-- CAUSA: is_admin() = super-admin OU EXISTS(org_users WHERE user_id=auth.uid()),
-- sem escopo de organização. Como há mais de uma org, qualquer org_user de uma org
-- passava no `... OR is_admin()` das policies de dados de QUALQUER clínica (inclusive
-- de outra org).
--
-- FIX: troca cirúrgica do token is_admin() -> is_clinic_admin(clinic_id) nas policies
-- de dados de clínica, escopando o bypass à organização DONA da clínica. O caminho
-- rápido do clinic_user (InitPlan) e a estrutura das policies ficam intactos —
-- preserva semântica e performance. Em policies de conteúdo global/super-admin, troca
-- por is_super_admin().
--
-- is_admin() permanece DEFINIDA (não removida) para não afetar outras dependências.
-- Rollback fiel em supabase/_rollbacks/20260624000001_scope_clinic_access_ROLLBACK.sql.
--
-- Semântica nova:
--   is_super_admin()           -> apenas super-admin
--   is_clinic_admin(clinic_id) -> super-admin OU membro da org dona da clínica
--     (vale mesmo p/ clínica desativada: org pode administrar; staff continua
--      bloqueado em clínica inativa pelo ramo clinic_user + is_clinic_active).

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_users
    WHERE id = auth.uid() AND role = 'super-admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_clinic_admin(p_clinic_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.clinic_users WHERE id = auth.uid() AND role = 'super-admin')
    OR EXISTS (
      SELECT 1
      FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE c.id = p_clinic_id AND ou.user_id = auth.uid()
    );
$$;

-- ============ Dados de clínica: is_admin() -> is_clinic_admin(clinic_id) ============

DROP POLICY IF EXISTS ai_config_all ON public.ai_config;
CREATE POLICY ai_config_all ON public.ai_config AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS appointments_all ON public.appointments;
CREATE POLICY appointments_all ON public.appointments AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));
DROP POLICY IF EXISTS appointments_doctor_isolation ON public.appointments;
CREATE POLICY appointments_doctor_isolation ON public.appointments AS PERMISSIVE FOR SELECT TO public USING (((((doctor_id IN ( SELECT d.id FROM doctors d WHERE (d.user_id = auth.uid()))) OR (EXISTS ( SELECT 1 FROM clinic_users WHERE ((clinic_users.id = auth.uid()) AND (clinic_users.role = ANY (ARRAY['gestor'::text, 'medico_gestor'::text, 'secretaria'::text])))))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS automation_logs_all ON public.automation_logs;
CREATE POLICY automation_logs_all ON public.automation_logs AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS chat_messages_all ON public.chat_messages;
CREATE POLICY chat_messages_all ON public.chat_messages AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));
DROP POLICY IF EXISTS chat_messages_org_access ON public.chat_messages;
CREATE POLICY chat_messages_org_access ON public.chat_messages AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS users_all ON public.clinic_users;
CREATE POLICY users_all ON public.clinic_users AS PERMISSIVE FOR ALL TO public USING (((((id = auth.uid()) OR (clinic_id = get_my_clinic_id())) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS clinics_all ON public.clinics;
CREATE POLICY clinics_all ON public.clinics AS PERMISSIVE FOR ALL TO public USING ((((id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND (is_active = true)) OR is_clinic_admin(id)));

DROP POLICY IF EXISTS consultation_types_all ON public.consultation_types;
CREATE POLICY consultation_types_all ON public.consultation_types AS PERMISSIVE FOR ALL TO authenticated USING (((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) OR is_clinic_admin(clinic_id))) WITH CHECK (((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS clinic_conversions_access ON public.conversions;
CREATE POLICY clinic_conversions_access ON public.conversions AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS doctors_all ON public.doctors;
CREATE POLICY doctors_all ON public.doctors AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS exam_requests_access ON public.exam_requests;
CREATE POLICY exam_requests_access ON public.exam_requests AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS financial_transactions_all ON public.financial_transactions;
CREATE POLICY financial_transactions_all ON public.financial_transactions AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS funnel_stages_all ON public.funnel_stages;
CREATE POLICY funnel_stages_all ON public.funnel_stages AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS lead_stage_history_all ON public.lead_stage_history;
CREATE POLICY lead_stage_history_all ON public.lead_stage_history AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));
DROP POLICY IF EXISTS lead_stage_history_org_access ON public.lead_stage_history;
CREATE POLICY lead_stage_history_org_access ON public.lead_stage_history AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS leads_all ON public.leads;
CREATE POLICY leads_all ON public.leads AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));
DROP POLICY IF EXISTS leads_org_access ON public.leads;
CREATE POLICY leads_org_access ON public.leads AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS marketing_data_all ON public.marketing_data;
CREATE POLICY marketing_data_all ON public.marketing_data AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS medical_records_all ON public.medical_records;
CREATE POLICY medical_records_all ON public.medical_records AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));
DROP POLICY IF EXISTS medical_records_doctor_isolation ON public.medical_records;
CREATE POLICY medical_records_doctor_isolation ON public.medical_records AS PERMISSIVE FOR SELECT TO public USING (((((doctor_id IN ( SELECT d.id FROM doctors d WHERE (d.user_id = auth.uid()))) OR (EXISTS ( SELECT 1 FROM clinic_users WHERE ((clinic_users.id = auth.uid()) AND (clinic_users.role = ANY (ARRAY['gestor'::text, 'medico_gestor'::text, 'secretaria'::text])))))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS patients_all ON public.patients;
CREATE POLICY patients_all ON public.patients AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS prescriptions_access ON public.prescriptions;
CREATE POLICY prescriptions_access ON public.prescriptions AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS protocols_access ON public.protocols;
CREATE POLICY protocols_access ON public.protocols AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS sla_breaches_all ON public.sla_breaches;
CREATE POLICY sla_breaches_all ON public.sla_breaches AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS stage_transition_rules_all ON public.stage_transition_rules;
CREATE POLICY stage_transition_rules_all ON public.stage_transition_rules AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id))) WITH CHECK ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS tickets_all ON public.tickets;
CREATE POLICY tickets_all ON public.tickets AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS whatsapp_events_select ON public.whatsapp_events;
CREATE POLICY whatsapp_events_select ON public.whatsapp_events AS PERMISSIVE FOR SELECT TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

DROP POLICY IF EXISTS whatsapp_all ON public.whatsapp_instances;
CREATE POLICY whatsapp_all ON public.whatsapp_instances AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_clinic_admin(clinic_id)));

-- ============ Conteúdo global / super-admin: is_admin() -> is_super_admin() ============

DROP POLICY IF EXISTS "Super admins can do everything on marketing data" ON public.marketing_data;
CREATE POLICY "Super admins can do everything on marketing data" ON public.marketing_data AS PERMISSIVE FOR ALL TO public USING (is_super_admin());

DROP POLICY IF EXISTS "Allow read access to users related to assignments" ON public.org_clinic_assignments;
CREATE POLICY "Allow read access to users related to assignments" ON public.org_clinic_assignments AS PERMISSIVE FOR SELECT TO public USING ((is_super_admin() OR (EXISTS ( SELECT 1 FROM org_users WHERE ((org_users.id = org_clinic_assignments.org_user_id) AND (org_users.user_id = auth.uid()))))));

DROP POLICY IF EXISTS prompt_templates_admin_write ON public.prompt_templates;
CREATE POLICY prompt_templates_admin_write ON public.prompt_templates AS PERMISSIVE FOR ALL TO public USING (is_super_admin()) WITH CHECK (is_super_admin());
