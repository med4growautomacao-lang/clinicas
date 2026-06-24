-- Migra o ENVIO do follow-up de boas-vindas do n8n para o Supabase nativo.
--
-- O selector process_forms_followup() (cron forms-followup-job, 1/min) continua escolhendo os
-- forms leads elegíveis, mas agora:
--   (1) aplica o gate "ainda não respondeu" (antes vivia no n8n, nó If1);
--   (2) chama a Edge Function nativa forms-welcome-followup em vez do webhook n8n;
--   (3) passa welcome_message_text no payload;
--   (4) NÃO marca mais welcome_sent aqui — o claim atômico passou para a edge (resiliência: se a
--       edge estiver fora do ar, o lead segue elegível e é re-tentado; o claim na edge evita o
--       envio duplicado).

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
          AND (l.last_message_at IS NULL OR l.last_message_at < l.created_at)  -- ainda não respondeu
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
        -- welcome_sent é marcado pela edge (claim atômico), não mais aqui.
    END LOOP;
END;
$function$;
