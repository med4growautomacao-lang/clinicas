-- Falha de INFRA não pode mais queimar o lead.
--
-- Caso real (Clínica Vaz, 10–13/07): o WhatsApp da clínica ficou desconectado
-- ("session is not reconnectable", 503) e depois foi restringido pelo próprio WhatsApp
-- (erro 463, reachout_timelock até 17/07 — punição por iniciar conversa com quem nunca escreveu).
-- A edge tratou isso como falha comum: gastou as 3 tentativas e desistiu, deixando welcome_sent=true.
-- Resultado: **14 leads reais preencheram o formulário e nunca receberam nada** — e nunca receberiam,
-- porque para o sistema já tinham sido atendidos.
--
-- Correção em duas frentes:
--   (1) `whatsapp_instances.send_blocked_until` — quando a uazapi diz até quando a conta está
--       restrita (ela informa o `until`!), guardamos. O selector para de enfileirar até lá, em vez
--       de martelar a API a cada minuto.
--   (2) O selector só considera clínicas com a instância CONECTADA. Se o WhatsApp caiu, o lead
--       espera na fila (welcome_sent continua false) e é atendido quando a conta voltar.
-- A edge complementa: erro de infra reverte o claim SEM consumir tentativa (deploy separado).

begin;

alter table public.whatsapp_instances
  add column if not exists send_blocked_until timestamptz;

comment on column public.whatsapp_instances.send_blocked_until is
  'Até quando esta conta está impedida de INICIAR conversas (ex: WhatsApp erro 463 / reachout_timelock). Preenchido pela edge a partir do "until" que a uazapi devolve. Enquanto estiver no futuro, os selectors de follow-up não enfileiram envios para esta clínica.';

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
          -- Não enfileira se o WhatsApp da clínica está fora do ar ou restrito: sem isto, o lead
          -- gasta as tentativas contra uma parede e é abandonado (foi o que aconteceu na Vaz).
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

commit;
