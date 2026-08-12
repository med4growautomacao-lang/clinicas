-- 20260713202802_welcome_no_burn_on_infra_failure
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

alter table public.whatsapp_instances
  add column if not exists send_blocked_until timestamptz;

comment on column public.whatsapp_instances.send_blocked_until is
  'Ate quando esta conta esta impedida de INICIAR conversas (ex: WhatsApp erro 463 / reachout_timelock). Preenchido pela edge a partir do "until" da uazapi. Enquanto no futuro, os selectors de follow-up nao enfileiram envios para esta clinica.';

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
          AND (l.last_message_at IS NULL OR l.last_message_at < l.created_at)
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

        PERFORM net.http_post(
            url := v_url,
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := v_payload
        );
    END LOOP;
END;
$function$;
