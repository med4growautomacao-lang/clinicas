-- Regras extras do welcome de forms (process_forms_followup):
--  (1) só dispara se o lead NÃO tem NENHUMA mensagem (não recebeu nem enviou) — se já há conversa,
--      não faz sentido dar boas-vindas. Substitui o gate anterior (last_message_at), mais preciso.
--  (2) só dispara se o lead foi criado há no máximo 3 dias (lead velho sem contato não recebe welcome).
-- Preserva o resto (system_http_post p/ Central de Erros + gate de WhatsApp conectado/não-bloqueado).
create or replace function public.process_forms_followup()
 returns void
 language plpgsql
as $function$
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
          AND NOT EXISTS (SELECT 1 FROM public.chat_messages cm WHERE cm.lead_id = l.id)   -- (1)
          AND l.created_at >= (v_now - interval '3 days')                                   -- (2)
          AND l.created_at < (v_now - (ac.welcome_message_delay || ' minutes')::interval)
          AND EXISTS (
                SELECT 1 FROM public.whatsapp_instances wi
                WHERE wi.clinic_id = l.clinic_id
                  AND wi.status = 'connected'
                  AND (wi.send_blocked_until IS NULL OR wi.send_blocked_until <= now())
              )
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
