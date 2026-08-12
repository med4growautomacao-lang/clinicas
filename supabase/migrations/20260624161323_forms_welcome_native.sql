-- 20260624161323_forms_welcome_native
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.process_forms_followup()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    r RECORD;
    v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/forms-welcome-followup';
    v_payload jsonb;
    v_now timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
BEGIN
    FOR r IN
        SELECT
            l.id, l.name, l.phone, l.clinic_id,
            ac.phone AS clinic_phone,
            ac.welcome_message_text
        FROM public.leads l
        JOIN public.ai_config ac ON l.clinic_id = ac.clinic_id
        WHERE l.capture_channel = 'forms'
          AND l.welcome_sent = false
          AND l.phone IS NOT NULL AND l.phone <> ''
          AND ac.welcome_message_enabled = true
          AND (l.last_message_at IS NULL OR l.last_message_at < l.created_at)
          AND l.created_at < (v_now - (ac.welcome_message_delay || ' minutes')::interval)
    LOOP
        v_payload := jsonb_build_object(
            'lead_id', r.id,
            'name', r.name,
            'phone', r.phone,
            'clinic_id', r.clinic_id,
            'clinic_phone', r.clinic_phone,
            'message_text', r.welcome_message_text,
            'type', 'welcome'
        );

        PERFORM net.http_post(
            url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := v_payload
        );
    END LOOP;
END;
$function$;
