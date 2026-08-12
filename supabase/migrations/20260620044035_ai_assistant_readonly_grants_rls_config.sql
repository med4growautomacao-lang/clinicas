-- 20260620044035_ai_assistant_readonly_grants_rls_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Assistente de IA: acesso somente-leitura por clínica para o papel assistant_ro.
-- Escopo travado por GUC app.clinic_id (setado pela Edge Function a cada request).
-- Policies TO assistant_ro são aditivas e NÃO afetam authenticated/anon (o app).

-- 1) Tabelas de negócio com clinic_id: GRANT SELECT total + policy de leitura por clínica.
DO $mig$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'ai_config','appointments','automation_logs','booking_requests','chat_messages',
    'clinic_users','consultation_types','conversions','doctors','exam_requests',
    'financial_transactions','funnel_stages','lead_stage_history','lead_tracking_inbox',
    'leads','link_sessions','marketing_data','medical_records','merge_audit_2026_05_14',
    'org_clinic_assignments','patients','pending_clinic_users','prescriptions','protocols',
    'sla_breaches','stage_transition_rules','tickets','whatsapp_events'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO assistant_ro', t);
    EXECUTE format('DROP POLICY IF EXISTS assistant_ro_read ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY assistant_ro_read ON public.%I FOR SELECT TO assistant_ro '
      'USING (clinic_id = NULLIF(current_setting(''app.clinic_id'', true), '''')::uuid)',
      t);
  END LOOP;
END
$mig$;

-- 2) whatsapp_instances: mascara segredos (api_token, connect_token, qr_code, api_id).
GRANT SELECT (
  id, clinic_id, phone_number, status, connected_at, clinic_name, connected_at_sp,
  redirect_message, qr_expires_at, attempt_id, attempt_started_at, last_event_at, last_error
) ON public.whatsapp_instances TO assistant_ro;
DROP POLICY IF EXISTS assistant_ro_read ON public.whatsapp_instances;
CREATE POLICY assistant_ro_read ON public.whatsapp_instances FOR SELECT TO assistant_ro
  USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- 3) clinics: contexto da própria clínica, mascara meta_token e google_ad_mcc_token.
GRANT SELECT (
  id, name, cnpj, phone, address, logo_url, primary_color, plan, created_at,
  notification_group_id, meta_ad_account_id, meta_pixel_id, wa_pre_msg, organization_id,
  category, google_ad_account_id, google_ad_mcc_id, is_active, features,
  meta_status, google_status, site_status, forms_status
) ON public.clinics TO assistant_ro;
DROP POLICY IF EXISTS assistant_ro_read ON public.clinics;
CREATE POLICY assistant_ro_read ON public.clinics FOR SELECT TO assistant_ro
  USING (id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);

-- 4) Config editável pelo Super Admin (lida pela Edge Function a cada conversa).
INSERT INTO public.system_settings (id, value, description, updated_at)
VALUES (
  'ai_assistant_config',
  '{"enabled":true,"model":"claude-sonnet-4-6","system_prompt":"Você é o assistente de dados de uma clínica. Responda em português, de forma objetiva e amigável, usando SOMENTE os dados retornados pelas consultas SQL de leitura. Nunca invente dados; se não encontrar, diga que não há registros. Apresente números de forma clara (datas no formato dia/mês, valores em R$).","max_rows":200,"timeout_s":15,"welcome_message":"Oi! Posso te ajudar com leads, agendamentos, faturamento e funil desta clínica. O que você quer saber?","example_questions":["Quantos leads novos entraram este mês?","Qual foi o faturamento dos últimos 30 dias?","Quantas consultas estão agendadas para esta semana?","Quais os principais motivos de perda?"],"allowed_roles":["gestor","medico_gestor","secretaria","vendedor"]}',
  'Configuração do Assistente de IA (botão flutuante)',
  now()
)
ON CONFLICT (id) DO NOTHING;
