-- 20260727231438_20260727231345_fase3b_rls_my_clinic_ids_standard_tables
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- FASE 3b (consistência): migra para a régua my_clinic_ids() todas as policies de forma STANDARD
-- restantes — (clinic_users braço + is_clinic_active) [OR (org braço)] OR is_clinic_admin(clinic_id).
-- Prova de equivalência: idêntica à da fase3 (219=219 pares), porque is_clinic_admin(clinic) =
-- super-admin OR membro-da-org colapsa com o braço org de my_clinic_ids. A substituição é
-- EQUIVALENTE, então é segura inclusive em tabelas sensíveis (patients/medical_records/financial)
-- e mesmo quando há uma 2ª policy na tabela (o resultado combinado não muda).
--
-- NÃO migradas de propósito (forma diferente, régua NÃO é equivalente):
--   clinic_users (self-ref id=auth.uid()), clinic_enc_keys (member-only sem admin/org, migrar
--   ampliaria acesso a chaves), clinic_external_integrations/consultation_types/external_* (sem
--   is_clinic_active — migrar restringiria clínica inativa), admin-only (lead_kpi_attribution,
--   meta_cloud_*, outbound_messages, report_*, historical_leads_import_log), role-específicas
--   (financial_gestor_only, pending_clinic_users, prontuario_passwords).
--
-- ALTER POLICY preserva cmd/roles/permissive; só a expressão muda. Todas essas tabelas são
-- pequenas ou lidas por RPC DEFINER, então o ganho aqui é CONSISTÊNCIA, não escala.

-- Só USING (sem with check) ------------------------------------------------------
alter policy ai_config_all on public.ai_config using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy appointments_all on public.appointments using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy automation_logs_all on public.automation_logs using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy conv_ai_insights_read on public.conv_ai_insights using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy conv_ai_prompt_versions_read on public.conv_ai_prompt_versions using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy clinic_conversions_access on public.conversions using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy doctors_all on public.doctors using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy exam_requests_access on public.exam_requests using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy financial_transactions_all on public.financial_transactions using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy followup_steps_all on public.followup_steps using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy funnel_stages_all on public.funnel_stages using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy marketing_data_all on public.marketing_data using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy marketing_spend_breakdown_read on public.marketing_spend_breakdown using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy medical_records_all on public.medical_records using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy patients_all on public.patients using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy prescriptions_access on public.prescriptions using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy protocols_access on public.protocols using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy sla_breaches_all on public.sla_breaches using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy whatsapp_events_select on public.whatsapp_events using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy whatsapp_all on public.whatsapp_instances using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

-- USING + WITH CHECK (policies FOR ALL com with_check explícito) -------------------
alter policy conv_ai_clinic_config_all on public.conv_ai_clinic_config
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy products_access on public.products
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy quote_images_access on public.quote_images
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy redirect_links_access on public.redirect_links
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
alter policy stage_transition_rules_all on public.stage_transition_rules
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

-- clinics: keyed em id (não clinic_id) -------------------------------------------
alter policy clinics_all on public.clinics
  using (id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

-- notifications / payments: duas policies (clinic + org). A régua cobre org, então altera a
-- de clínica e dropa a de org (redundante). -------------------------------------
alter policy notifications_sel_clinic on public.notifications using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
drop policy notifications_sel_org on public.notifications;
alter policy payments_sel_clinic on public.payments using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
drop policy payments_sel_org on public.payments;
