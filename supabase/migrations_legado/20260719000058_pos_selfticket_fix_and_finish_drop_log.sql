-- Revisão pós-057 (auditoria adversarial): 2 achados.
--
-- FIX 1 (grave): a guarda "lead voltou" do pós barrava o PRÓPRIO ticket.
--   Medido: 52/52 dos "barrados por ticket aberto" eram o próprio ticket ainda status='open'
--   (legado resolvido-mas-open + fluxo move_ticket_keep_outcome, que mantém aberto DE PROPÓSITO).
--   Ou seja: nenhum lead tinha "voltado" — a guarda suprimia o pós desses 52 para sempre.
--   Fix: sinal de "voltou" = ticket aberto DIFERENTE (t2.id <> t.id) — um ciclo novo de verdade.
--
-- FIX 2 (observabilidade): encerramento é disparo ÚNICO (sem re-tentativa). Quando o drop é por
--   INFRA (WhatsApp desconectado/bloqueado/sem token), a mensagem morre em silêncio — registra na
--   Central (info) para não virar "sumiu a mensagem". Gates intencionais (toggle off, msg vazia,
--   mute do lead, is_not_lead) seguem silenciosos: são configuração, não falha.
--
-- (Verificado também: 0 clínicas multi-instância — joins não duplicam; WHEN do trigger não
--  re-dispara com o carimbo; 0 encerramentos pré-057 — dedup retroativo desnecessário.)

-- ---------------------------------------------------------------------------
-- FIX 1: pós — "voltou" = OUTRO ticket aberto, não o próprio
-- ---------------------------------------------------------------------------
create or replace function public.process_pos_followup()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_msg text;
  v_count integer := 0;
  v_expired integer := 0;
begin
  with expired as (
    update public.tickets t
       set pos_followup_expired_at = now()
      from public.ai_config ai
     where ai.clinic_id = t.clinic_id
       and t.outcome in ('ganho','perdido')
       and t.outcome_at is not null
       and t.pos_followup_sent_at is null
       and t.pos_followup_expired_at is null
       and (
         (t.outcome = 'ganho'
            and t.outcome_at < now() - ((coalesce(ai.pos_followup_ganho_days,1)  + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)
         or
         (t.outcome = 'perdido'
            and t.outcome_at < now() - ((coalesce(ai.pos_followup_perdido_days,1) + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)
       )
    returning 1
  )
  select count(*) into v_expired from expired;

  if v_expired > 0 then
    perform log_system_error('pos-followup','expired_suppressed',
      'Pós-atendimento retirado da fila por vencimento (janela expirada)','info',
      null, jsonb_build_object('count', v_expired), false);
  end if;

  for r in
    with cand as (
      select t.id as ticket_id, t.clinic_id, t.lead_id, t.outcome,
             normalize_br_phone(l.phone) as phone, l.name as lead_name,
             ai.pos_followup_ganho_message, ai.pos_followup_perdido_message, wa.api_token,
             row_number() over (partition by t.clinic_id order by t.outcome_at asc) as rn
      from tickets t
      join leads l on l.id = t.lead_id
      join ai_config ai on ai.clinic_id = t.clinic_id
      join whatsapp_instances wa on wa.clinic_id = t.clinic_id
      where t.outcome in ('ganho','perdido') and t.outcome_at is not null
        and t.pos_followup_sent_at is null and t.pos_followup_expired_at is null
        and wa.status = 'connected'
        and (wa.send_blocked_until is null or wa.send_blocked_until <= now())
        and coalesce(l.followup_enabled, true) = true and coalesce(l.is_not_lead, false) = false
        -- "lead voltou" = existe OUTRO ticket aberto (ciclo novo) — o próprio ticket
        -- pode legitimamente seguir open (legado resolvido-open / move_ticket_keep_outcome)
        and not exists (
          select 1 from tickets t2
          where t2.lead_id = t.lead_id and t2.status = 'open' and t2.id <> t.id
        )
        and not exists (
          select 1 from chat_messages cm
          where cm.lead_id = t.lead_id and cm.direction = 'inbound'
            and cm.created_at > (t.outcome_at at time zone 'America/Sao_Paulo')
        )
        and (
          (t.outcome = 'ganho' and coalesce(ai.pos_followup_ganho_enabled,false)
            and t.outcome_at <= now() - (coalesce(ai.pos_followup_ganho_days,1) || ' days')::interval
            and t.outcome_at >= now() - ((coalesce(ai.pos_followup_ganho_days,1)  + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)
          or
          (t.outcome = 'perdido' and coalesce(ai.pos_followup_perdido_enabled,false)
            and t.outcome_at <= now() - (coalesce(ai.pos_followup_perdido_days,1) || ' days')::interval
            and t.outcome_at >= now() - ((coalesce(ai.pos_followup_perdido_days,1) + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)
        )
        and extract(hour from now() at time zone 'America/Sao_Paulo') >= 8
        and extract(hour from now() at time zone 'America/Sao_Paulo') < 20
    )
    select ticket_id, clinic_id, lead_id, outcome, phone, lead_name,
           pos_followup_ganho_message, pos_followup_perdido_message, api_token
    from cand
    where rn <= 5
  loop
    begin
      v_msg := case when r.outcome = 'ganho' then r.pos_followup_ganho_message else r.pos_followup_perdido_message end;
      if v_msg is null or btrim(v_msg) = '' then
        update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
        continue;
      end if;
      if r.phone is null or r.api_token is null or btrim(r.api_token) = '' then continue; end if;
      v_msg := replace(replace(v_msg, '{paciente}', coalesce(r.lead_name,'')), '{nome}', coalesce(r.lead_name,''));

      perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.phone, 'text', v_msg, 'delay', 0), 5000);

      insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
      values (r.clinic_id, r.lead_id, r.phone, 'outbound', 'system',
              jsonb_build_object('type','system','content', 'PÓS-ATENDIMENTO: ' || v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

      update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
      v_count := v_count + 1;
    exception when others then
      perform log_system_error('pos-followup','send_failed','Falha ao enviar pós-atendimento',
        'error', r.clinic_id, jsonb_build_object('ticket_id', r.ticket_id, 'detail', sqlerrm), false);
    end;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('pos-followup','job_failed','Falha no job de pós-atendimento','error',
    null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $function$;

-- ---------------------------------------------------------------------------
-- FIX 2: encerramento — drop por INFRA vira evento na Central (info)
-- ---------------------------------------------------------------------------
create or replace function public.fn_ticket_finish_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_event text; v_msg text; v_prefix text; v_cfg record;
  v_phone text; v_name text; v_token text;
  v_is_not_lead boolean; v_fu_enabled boolean;
  v_wa_status text; v_blocked timestamptz;
begin
  if NEW.outcome is distinct from OLD.outcome and NEW.outcome = 'ganho' then v_event := 'ganho';
  elsif NEW.outcome is distinct from OLD.outcome and NEW.outcome = 'perdido' then v_event := 'perdido';
  elsif NEW.status is distinct from OLD.status and NEW.status = 'closed'
        and NEW.outcome is not distinct from OLD.outcome then v_event := 'service';
  else return NEW; end if;

  if NEW.lead_id is null then return NEW; end if;

  if NEW.finish_message_event is not distinct from v_event then return NEW; end if;

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

  select normalize_br_phone(phone), name, coalesce(is_not_lead,false), coalesce(followup_enabled,true)
    into v_phone, v_name, v_is_not_lead, v_fu_enabled
    from leads where id = NEW.lead_id;
  if v_phone is null then return NEW; end if;
  if v_is_not_lead then return NEW; end if;
  if not v_fu_enabled then return NEW; end if;

  select status, api_token, send_blocked_until
    into v_wa_status, v_token, v_blocked
    from whatsapp_instances where clinic_id = NEW.clinic_id
    order by (status = 'connected') desc nulls last limit 1;

  -- Encerramento é disparo ÚNICO: se cair aqui, a msg morre sem re-tentativa.
  -- Drop por INFRA não pode ser silencioso — registra (info) na Central.
  if v_token is null or btrim(v_token) = ''
     or v_wa_status is distinct from 'connected'
     or (v_blocked is not null and v_blocked > now()) then
    perform log_system_error('encerramento','finish_dropped_infra',
      'Mensagem de encerramento NÃO enviada: WhatsApp indisponível (disparo único, sem re-tentativa)',
      'info', NEW.clinic_id,
      jsonb_build_object('ticket_id', NEW.id, 'event', v_event,
        'wa_status', v_wa_status, 'blocked_until', v_blocked, 'has_token', v_token is not null),
      false);
    return NEW;
  end if;

  v_msg := replace(replace(v_msg, '{paciente}', coalesce(v_name, '')), '{nome}', coalesce(v_name, ''));

  perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
    jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
    jsonb_build_object('number', v_phone, 'text', v_msg, 'delay', 0), 5000);

  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
  values (NEW.clinic_id, NEW.lead_id, v_phone, 'outbound', 'system',
          jsonb_build_object('type','system','content', v_prefix || v_msg,
                             'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

  perform set_config('app.keep_ticket_outcome', 'on', true);
  update tickets set finish_message_event = v_event, finish_message_sent_at = now() where id = NEW.id;

  return NEW;
exception when others then
  perform log_system_error('encerramento','finish_send_failed','Falha ao enviar mensagem de encerramento',
    'error', NEW.clinic_id, jsonb_build_object('ticket_id', NEW.id, 'event', v_event, 'detail', sqlerrm), false);
  return NEW;
end; $function$;
