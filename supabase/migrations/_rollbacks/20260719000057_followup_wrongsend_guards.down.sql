-- Rollback de 20260719000057 (guardas de envio errado).
-- Restaura as 5 funções às versões anteriores. As colunas finish_message_* podem ficar
-- (inertes) ou cair no final. ATENÇÃO: reverter reabre as brechas da auditoria.

-- fn_ticket_finish_message -> versão 20260719000055 (sem dedup / sem guardas de mute/connected).
create or replace function public.fn_ticket_finish_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_event text; v_msg text; v_prefix text; v_cfg record; v_phone text; v_name text; v_token text;
begin
  if NEW.outcome is distinct from OLD.outcome and NEW.outcome = 'ganho' then v_event := 'ganho';
  elsif NEW.outcome is distinct from OLD.outcome and NEW.outcome = 'perdido' then v_event := 'perdido';
  elsif NEW.status is distinct from OLD.status and NEW.status = 'closed'
        and NEW.outcome is not distinct from OLD.outcome then v_event := 'service';
  else return NEW; end if;

  if NEW.lead_id is null then return NEW; end if;

  select finish_ganho_enabled, finish_ganho_message, finish_perdido_enabled, finish_perdido_message,
         finish_service_enabled, finish_service_message
    into v_cfg from ai_config where clinic_id = NEW.clinic_id;
  if v_cfg is null then return NEW; end if;

  if v_event = 'ganho' then
    if not coalesce(v_cfg.finish_ganho_enabled, false) then return NEW; end if;
    v_msg := v_cfg.finish_ganho_message; v_prefix := 'ENCERRAMENTO GANHO: ';
  elsif v_event = 'perdido' then
    if not coalesce(v_cfg.finish_perdido_enabled, false) then return NEW; end if;
    v_msg := v_cfg.finish_perdido_message; v_prefix := 'ENCERRAMENTO PERDIDO: ';
  else
    if not coalesce(v_cfg.finish_service_enabled, false) then return NEW; end if;
    v_msg := v_cfg.finish_service_message; v_prefix := 'ENCERRAMENTO: ';
  end if;

  if v_msg is null or btrim(v_msg) = '' then return NEW; end if;
  select normalize_br_phone(phone), name into v_phone, v_name from leads where id = NEW.lead_id;
  if v_phone is null then return NEW; end if;
  v_msg := replace(replace(v_msg, '{paciente}', coalesce(v_name, '')), '{nome}', coalesce(v_name, ''));
  select api_token into v_token from whatsapp_instances where clinic_id = NEW.clinic_id limit 1;
  if v_token is null or btrim(v_token) = '' then return NEW; end if;

  perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
    jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
    jsonb_build_object('number', v_phone, 'text', v_msg, 'delay', 0), 5000);

  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
  values (NEW.clinic_id, NEW.lead_id, v_phone, 'outbound', 'system',
          jsonb_build_object('type','system','content', v_prefix || v_msg,
                             'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));
  return NEW;
exception when others then
  perform log_system_error('encerramento','finish_send_failed','Falha ao enviar mensagem de encerramento',
    'error', NEW.clinic_id, jsonb_build_object('ticket_id', NEW.id, 'event', v_event, 'detail', sqlerrm), false);
  return NEW;
end; $function$;

-- Cron functions -> versões 20260719000056 (com cap de vencimento, sem as guardas de 057).
-- Reengajamento: remove connected/send_blocked (lateral volta a phone_number/api_token).
create or replace function public.process_reengagement_followup()
 returns void language plpgsql as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/reengagement-followup';
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5; v_payload jsonb;
begin
  for r in
    with elegiveis as (
      select l.id, l.name, l.phone, l.clinic_id, l.followup_count, w.phone_number as clinic_phone,
             s.message_text, s.step_no, s.is_closing,
             row_number() over (partition by l.clinic_id order by lm.last_at asc) as rn
      from public.leads l
      join public.ai_config ac on ac.clinic_id = l.clinic_id
      join public.followup_steps s on s.clinic_id = l.clinic_id and s.step_no = l.followup_count + 1 and s.enabled = true
      join lateral (select wi.phone_number, wi.api_token from public.whatsapp_instances wi where wi.clinic_id = l.clinic_id limit 1) w on true
      join lateral (select cm.direction as last_dir, cm.created_at as last_at from public.chat_messages cm where cm.lead_id = l.id order by cm.seq desc limit 1) lm on true
      where ac.followup_enabled = true and l.followup_enabled = true and l.ai_enabled = true
        and l.handoff_triggered_at is null and l.converted_patient_id is null and coalesce(l.is_not_lead, false) = false
        and w.api_token is not null and l.phone is not null and l.phone <> ''
        and v_hour >= coalesce(ac.followup_window_start, 6) and v_hour < coalesce(ac.followup_window_end, 22)
        and not exists (select 1 from public.tickets t where t.lead_id = l.id and t.outcome = 'ganho')
        and exists (select 1 from public.tickets t join public.funnel_stages fs on fs.id = t.stage_id
                    where t.lead_id = l.id and t.status = 'open' and fs.slug not in ('agendado','compareceu','ganho','perdido'))
        and lm.last_dir = 'outbound'
        and lm.last_at < (v_now - (s.delay_minutes || ' minutes')::interval)
        and lm.last_at >= (v_now - (coalesce(ac.followup_max_idle_days, 7) || ' days')::interval)
        and (l.followup_sent_at is null or l.followup_sent_at < (v_now - (s.delay_minutes || ' minutes')::interval))
    )
    select id, name, phone, clinic_id, followup_count, clinic_phone, message_text, step_no, is_closing
    from elegiveis where rn <= v_max_per_clinic
  loop
    v_payload := jsonb_build_object('lead_id', r.id, 'clinic_id', r.clinic_id, 'name', r.name, 'phone', r.phone,
      'clinic_phone', r.clinic_phone, 'message_text', r.message_text, 'step_no', r.step_no,
      'is_closing', r.is_closing, 'expected_count', r.followup_count);
    perform public.system_http_post(url := v_url, headers := jsonb_build_object('Content-Type', 'application/json'), body := v_payload);
  end loop;
end; $function$;

-- Pós -> 056 (sem guarda "lead voltou" e sem send_blocked). Confirmação e Welcome: reaplicar
-- os blocos CREATE OR REPLACE de 20260719000055 / origem (removendo nullif/send_blocked/is_not_lead).
-- (Blocos completos disponíveis nas migrations de origem; reverter só se necessário.)

-- Opcional (só se revertendo o conceito inteiro):
-- alter table public.tickets drop column if exists finish_message_event;
-- alter table public.tickets drop column if exists finish_message_sent_at;
