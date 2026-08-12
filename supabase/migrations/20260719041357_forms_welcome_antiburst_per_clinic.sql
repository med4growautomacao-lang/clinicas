-- 20260719041357_forms_welcome_antiburst_per_clinic
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
    v_hour int := extract(hour from now() AT TIME ZONE 'America/Sao_Paulo');
    v_max_per_clinic int := 3;
BEGIN
    FOR r IN
        WITH elegiveis AS (
            SELECT
                l.id, l.name, l.phone, l.clinic_id,
                ac.phone AS clinic_phone,
                ac.welcome_message_text,
                row_number() OVER (PARTITION BY l.clinic_id ORDER BY l.created_at ASC) AS rn
            FROM public.leads l
            JOIN public.ai_config ac ON l.clinic_id = ac.clinic_id
            WHERE l.capture_channel = 'forms'
              AND l.welcome_sent = false
              AND l.phone IS NOT NULL AND l.phone <> ''
              AND ac.welcome_message_enabled = true
              AND NOT EXISTS (SELECT 1 FROM public.chat_messages cm WHERE cm.lead_id = l.id)
              AND l.created_at >= (v_now - interval '3 days')
              AND l.created_at < (v_now - (ac.welcome_message_delay || ' minutes')::interval)
              AND v_hour >= COALESCE(ac.welcome_window_start, 6)
              AND v_hour <  COALESCE(ac.welcome_window_end, 22)
              AND EXISTS (
                    SELECT 1 FROM public.whatsapp_instances wi
                    WHERE wi.clinic_id = l.clinic_id
                      AND wi.status = 'connected'
                      AND (wi.send_blocked_until IS NULL OR wi.send_blocked_until <= now())
                  )
        )
        SELECT id, name, phone, clinic_id, clinic_phone, welcome_message_text
        FROM elegiveis
        WHERE rn <= v_max_per_clinic
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

        PERFORM public.system_http_post(
            url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := v_payload
        );
    END LOOP;
END;
$function$;
