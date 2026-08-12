-- 20260406195024_fix_process_forms_followup_logic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.process_forms_followup()
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
    r RECORD;
    v_url text := 'https://webhook.med4growautomacao.com.br/webhook/clinica/forms_followup';
    v_payload json;
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
          AND l.created_at < (now() - (ac.welcome_message_delay || ' minutes')::interval)
    LOOP
        v_payload := json_build_object(
            'lead_id', r.id,
            'name', r.name,
            'phone', r.phone,
            'clinic_id', r.clinic_id,
            'clinic_phone', r.clinic_phone,
            'type', 'welcome',
            'rast_id', r.rast_id,
            'google_ads', json_build_object(
                'g_clid', r.g_clid,
                'campaign', r.g_campaign_name
            )
        );

        -- Enviar para n8n
        PERFORM net.http_post(
            url := v_url,
            body := v_payload::text,
            headers := '{"Content-Type": "application/json"}'::jsonb
        );

        -- Marcar como enviado
        UPDATE public.leads SET welcome_sent = true WHERE id = r.id;

        -- Registrar log
        INSERT INTO public.automation_logs (clinic_id, lead_id, type, status, metadata)
        VALUES (r.clinic_id, r.id, 'forms_welcome', 'sent', v_payload::jsonb);

    END LOOP;
END;
$function$;
