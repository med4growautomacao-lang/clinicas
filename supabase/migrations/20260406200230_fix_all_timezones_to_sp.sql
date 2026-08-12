-- 20260406200230_fix_all_timezones_to_sp
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Corrige defaults das tabelas com now() sem timezone
ALTER TABLE public.funnel_stages
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

ALTER TABLE public.stage_transition_rules
  ALTER COLUMN created_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

ALTER TABLE public.system_settings
  ALTER COLUMN updated_at SET DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo');

-- Corrige a função: usa now() AT TIME ZONE SP para comparar com colunas em horário SP
CREATE OR REPLACE FUNCTION public.process_forms_followup()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    r RECORD;
    v_url text := 'https://webhook.med4growautomacao.com.br/webhook/clinica/forms_followup';
    v_payload jsonb;
    v_now timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
BEGIN
    FOR r IN 
        SELECT 
            l.*,
            ac.phone as clinic_phone,
            ac.welcome_message_delay
        FROM public.leads l
        JOIN public.ai_config ac ON l.clinic_id = ac.clinic_id
        WHERE l.capture_channel = 'forms'
          AND l.welcome_sent = false
          AND l.phone IS NOT NULL AND l.phone <> ''
          AND ac.welcome_message_enabled = true
          AND l.created_at < (v_now - (ac.welcome_message_delay || ' minutes')::interval)
    LOOP
        v_payload := jsonb_build_object(
            'lead_id', r.id,
            'name', r.name,
            'phone', r.phone,
            'clinic_id', r.clinic_id,
            'clinic_phone', r.clinic_phone,
            'type', 'welcome',
            'rast_id', r.rast_id,
            'google_ads', jsonb_build_object(
                'g_clid', r.g_clid,
                'campaign', r.g_campaign_name
            )
        );

        PERFORM net.http_post(
            url := v_url,
            body := v_payload
        );

        UPDATE public.leads SET welcome_sent = true WHERE id = r.id;

        INSERT INTO public.automation_logs (clinic_id, lead_id, type, status, metadata)
        VALUES (r.clinic_id, r.id, 'forms_welcome', 'sent', v_payload);

    END LOOP;
END;
$function$;
