-- ROLLBACK SNAPSHOT — estado EXATO das policies ANTES da migration
-- 20260624000001_scope_clinic_access_to_org.sql
--
-- NÃO é aplicado automaticamente (fica fora de supabase/migrations/).
-- Para reverter: rode este arquivo inteiro contra o banco. Ele restaura cada
-- policy ao USING/WITH CHECK original (com is_admin()). Os helpers novos
-- (is_super_admin / is_clinic_admin) podem ser deixados — são inofensivos —
-- ou dropados manualmente no fim.

-- ai_config
DROP POLICY IF EXISTS ai_config_all ON public.ai_config;
CREATE POLICY ai_config_all ON public.ai_config AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- appointments
DROP POLICY IF EXISTS appointments_all ON public.appointments;
CREATE POLICY appointments_all ON public.appointments AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));
DROP POLICY IF EXISTS appointments_doctor_isolation ON public.appointments;
CREATE POLICY appointments_doctor_isolation ON public.appointments AS PERMISSIVE FOR SELECT TO public USING (((((doctor_id IN ( SELECT d.id FROM doctors d WHERE (d.user_id = auth.uid()))) OR (EXISTS ( SELECT 1 FROM clinic_users WHERE ((clinic_users.id = auth.uid()) AND (clinic_users.role = ANY (ARRAY['gestor'::text, 'medico_gestor'::text, 'secretaria'::text])))))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- automation_logs
DROP POLICY IF EXISTS automation_logs_all ON public.automation_logs;
CREATE POLICY automation_logs_all ON public.automation_logs AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_admin()));

-- chat_messages
DROP POLICY IF EXISTS chat_messages_all ON public.chat_messages;
CREATE POLICY chat_messages_all ON public.chat_messages AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));
DROP POLICY IF EXISTS chat_messages_org_access ON public.chat_messages;
CREATE POLICY chat_messages_org_access ON public.chat_messages AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- clinic_users
DROP POLICY IF EXISTS users_all ON public.clinic_users;
CREATE POLICY users_all ON public.clinic_users AS PERMISSIVE FOR ALL TO public USING (((((id = auth.uid()) OR (clinic_id = get_my_clinic_id())) AND is_clinic_active(clinic_id)) OR is_admin()));

-- clinics
DROP POLICY IF EXISTS clinics_all ON public.clinics;
CREATE POLICY clinics_all ON public.clinics AS PERMISSIVE FOR ALL TO public USING ((((id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND (is_active = true)) OR is_admin()));

-- consultation_types
DROP POLICY IF EXISTS consultation_types_all ON public.consultation_types;
CREATE POLICY consultation_types_all ON public.consultation_types AS PERMISSIVE FOR ALL TO authenticated USING (((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) OR is_admin())) WITH CHECK (((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) OR is_admin()));

-- conversions
DROP POLICY IF EXISTS clinic_conversions_access ON public.conversions;
CREATE POLICY clinic_conversions_access ON public.conversions AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_admin()));

-- doctors
DROP POLICY IF EXISTS doctors_all ON public.doctors;
CREATE POLICY doctors_all ON public.doctors AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- exam_requests
DROP POLICY IF EXISTS exam_requests_access ON public.exam_requests;
CREATE POLICY exam_requests_access ON public.exam_requests AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_admin()));

-- financial_transactions
DROP POLICY IF EXISTS financial_transactions_all ON public.financial_transactions;
CREATE POLICY financial_transactions_all ON public.financial_transactions AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- funnel_stages
DROP POLICY IF EXISTS funnel_stages_all ON public.funnel_stages;
CREATE POLICY funnel_stages_all ON public.funnel_stages AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- lead_stage_history
DROP POLICY IF EXISTS lead_stage_history_all ON public.lead_stage_history;
CREATE POLICY lead_stage_history_all ON public.lead_stage_history AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));
DROP POLICY IF EXISTS lead_stage_history_org_access ON public.lead_stage_history;
CREATE POLICY lead_stage_history_org_access ON public.lead_stage_history AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- leads
DROP POLICY IF EXISTS leads_all ON public.leads;
CREATE POLICY leads_all ON public.leads AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));
DROP POLICY IF EXISTS leads_org_access ON public.leads;
CREATE POLICY leads_org_access ON public.leads AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- marketing_data
DROP POLICY IF EXISTS "Super admins can do everything on marketing data" ON public.marketing_data;
CREATE POLICY "Super admins can do everything on marketing data" ON public.marketing_data AS PERMISSIVE FOR ALL TO public USING (( SELECT is_admin() AS is_admin));
DROP POLICY IF EXISTS marketing_data_all ON public.marketing_data;
CREATE POLICY marketing_data_all ON public.marketing_data AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- medical_records
DROP POLICY IF EXISTS medical_records_all ON public.medical_records;
CREATE POLICY medical_records_all ON public.medical_records AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));
DROP POLICY IF EXISTS medical_records_doctor_isolation ON public.medical_records;
CREATE POLICY medical_records_doctor_isolation ON public.medical_records AS PERMISSIVE FOR SELECT TO public USING (((((doctor_id IN ( SELECT d.id FROM doctors d WHERE (d.user_id = auth.uid()))) OR (EXISTS ( SELECT 1 FROM clinic_users WHERE ((clinic_users.id = auth.uid()) AND (clinic_users.role = ANY (ARRAY['gestor'::text, 'medico_gestor'::text, 'secretaria'::text])))))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- org_clinic_assignments
DROP POLICY IF EXISTS "Allow read access to users related to assignments" ON public.org_clinic_assignments;
CREATE POLICY "Allow read access to users related to assignments" ON public.org_clinic_assignments AS PERMISSIVE FOR SELECT TO public USING ((is_admin() OR (EXISTS ( SELECT 1 FROM org_users WHERE ((org_users.id = org_clinic_assignments.org_user_id) AND (org_users.user_id = auth.uid()))))));

-- patients
DROP POLICY IF EXISTS patients_all ON public.patients;
CREATE POLICY patients_all ON public.patients AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- prescriptions
DROP POLICY IF EXISTS prescriptions_access ON public.prescriptions;
CREATE POLICY prescriptions_access ON public.prescriptions AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_admin()));

-- prompt_templates
DROP POLICY IF EXISTS prompt_templates_admin_write ON public.prompt_templates;
CREATE POLICY prompt_templates_admin_write ON public.prompt_templates AS PERMISSIVE FOR ALL TO public USING (is_admin()) WITH CHECK (is_admin());

-- protocols
DROP POLICY IF EXISTS protocols_access ON public.protocols;
CREATE POLICY protocols_access ON public.protocols AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_admin()));

-- sla_breaches
DROP POLICY IF EXISTS sla_breaches_all ON public.sla_breaches;
CREATE POLICY sla_breaches_all ON public.sla_breaches AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR (clinic_id IN ( SELECT c.id FROM (clinics c JOIN org_users ou ON ((ou.organization_id = c.organization_id))) WHERE (ou.user_id = auth.uid()))) OR is_admin()));

-- stage_transition_rules
DROP POLICY IF EXISTS stage_transition_rules_all ON public.stage_transition_rules;
CREATE POLICY stage_transition_rules_all ON public.stage_transition_rules AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin())) WITH CHECK ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- tickets
DROP POLICY IF EXISTS tickets_all ON public.tickets;
CREATE POLICY tickets_all ON public.tickets AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- whatsapp_events
DROP POLICY IF EXISTS whatsapp_events_select ON public.whatsapp_events;
CREATE POLICY whatsapp_events_select ON public.whatsapp_events AS PERMISSIVE FOR SELECT TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));

-- whatsapp_instances
DROP POLICY IF EXISTS whatsapp_all ON public.whatsapp_instances;
CREATE POLICY whatsapp_all ON public.whatsapp_instances AS PERMISSIVE FOR ALL TO public USING ((((clinic_id IN ( SELECT clinic_users.clinic_id FROM clinic_users WHERE (clinic_users.id = auth.uid()))) AND is_clinic_active(clinic_id)) OR is_admin()));
