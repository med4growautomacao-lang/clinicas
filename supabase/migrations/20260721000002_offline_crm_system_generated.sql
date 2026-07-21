-- Offline volta para o formato de EVENTO DE CRM (guia oficial da Meta): action_source=system_generated
-- + custom_data event_source='crm' e lead_event_source (adicionados na edge). physical_store (janela
-- 62d) era atalho de teste p/ conversoes antigas, mas nao e o formato CRM. Em producao a conversao e
-- enviada em tempo (minutos), entao a janela de 7 dias do system_generated nao e problema.
update public.system_settings
   set value = (coalesce(value::jsonb,'{}'::jsonb) || '{"offline_action_source":"system_generated"}'::jsonb)::text,
       updated_at = now()
 where id = 'meta_capi_config';
