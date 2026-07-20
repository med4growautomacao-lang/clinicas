-- MUDANÇA PROFUNDA: mensagens de AUTOMAÇÃO (followups) passam a sender='system' (+ message.type
-- 'system'), separadas do que o Agente IA realmente fala ('ai') e do humano ('human').
-- A constraint já aceitava 'system'; o master_logic PRESERVA 'system' quando o type do JSONB
-- não é user/human/ai (verificado). Na memória LangChain, type='system' vira SystemMessage
-- (contexto sem autoria da IA). Atribuição IA×Humano já conta só 'ai'/'human' → fica mais limpa.
--
-- Inclui o guard anti-DUPLA-RESPOSTA: quando a resposta de confirmação (Confirmar/Remarcar/
-- Cancelar) é tratada pelo trigger nativo, a mensagem NÃO é encaminhada ao Agente IA
-- (GUC transaction-local `app.confirmation_handled` setado pelo trigger durante o INSERT,
-- lido pelo ingest_wa_message na mesma transação).
--
-- Consumidores protegidos:
--   1. trg_zz_apply_stage_rules: system NUNCA dispara gatilho de etapa (senão a msg de
--      encerramento "parabéns, seu contrato foi assinado" casaria com a regra de Ganho).
--   2. fn_update_lead_last_fields: system não atualiza last_outbound_at (automação ≠ atendimento;
--      não fecha ciclo de SLA/1ª resposta). last_activity_at continua.
--   3. process_sla_unanswered: msg system não conta como resposta (não silencia o alerta).
--   4. get_dashboard_stats / get_commercial_dashboard: system fora do stream de tempo-de-resposta
--      (patch cirúrgico idempotente por replace no functiondef).
--   Atribuição (refresh_lead_attribution/get_commercial_leads) já conta só 'ai'/'human' → intacta.
--
-- Escritores migrados p/ system: fn_handle_confirmation_reply (respostas), fn_ticket_finish_message
-- (encerramento), process_pos_followup, process_confirmation_reminders (que agora também REGISTRA
-- o lembrete na conversa — antes não aparecia), edges forms-welcome-followup e reengagement-followup
-- (deploy separado). ai-scheduler/Agente IA continuam 'ai' (são o agente de fato).
--
-- NOTA: este arquivo foi aplicado via MCP apply_migration como
-- "followups_sender_system_and_confirm_ai_guard". Conteúdo idêntico ao aplicado.

-- 1) Gatilhos de etapa: system não dispara.
drop trigger if exists trg_zz_apply_stage_rules on public.chat_messages;
create trigger trg_zz_apply_stage_rules
  after insert on public.chat_messages
  for each row
  when (new.direction = 'outbound'
        and new.sender is distinct from 'ai'
        and new.sender is distinct from 'system'
        and new.lead_id is not null)
  execute function public.fn_apply_stage_rules();

-- 2) system não atualiza last_outbound_at.
create or replace function public.fn_update_lead_last_fields()
returns trigger language plpgsql as $$
begin
  if NEW.lead_id is not null then
    update public.leads
      set last_activity_at = NEW.created_at,
          last_message_at  = case when NEW.direction = 'inbound' then NEW.created_at else last_message_at end,
          last_outbound_at = case when NEW.direction = 'outbound' and NEW.sender is distinct from 'system'
                                  then NEW.created_at else last_outbound_at end
      where id = NEW.lead_id;
  end if;
  return NEW;
end; $$;

-- 3) SLA: system não conta como resposta.
create or replace function public.process_sla_unanswered(p_minutes integer default 15)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_now timestamp := (now() at time zone 'America/Sao_Paulo');
  v_dow text := extract(dow from v_now)::text;
  v_time text := to_char(v_now, 'HH24:MI');
  r record; v_count integer := 0;
begin
  for r in
    with cand as (
      select l.id, l.clinic_id, l.name, l.phone, l.sla_alerted_at,
             coalesce((c.notification_prefs->'sla'->>'enabled')::boolean, c.notification_group_id is not null) as sla_on,
             coalesce((c.notification_prefs->'sla'->>'minutes')::int, p_minutes) as sla_min
      from leads l join clinics c on c.id = l.clinic_id
      where l.last_activity_at > v_now - interval '6 hours'
        and coalesce(l.is_not_lead, false) = false
    ),
    open_clinic as (
      select distinct cand.clinic_id from cand
      where exists (
          select 1 from doctors d
          cross join lateral jsonb_array_elements(coalesce(d.working_hours -> v_dow, '[]'::jsonb)) sh
          where d.clinic_id = cand.clinic_id and d.is_active
            and v_time >= (sh->>'start') and v_time < (sh->>'end'))
        or (not exists (
              select 1 from doctors d
              where d.clinic_id = cand.clinic_id and d.is_active
                and coalesce(d.working_hours, '{}'::jsonb) <> '{}'::jsonb)
            and v_time >= '08:00' and v_time < '20:00')
    ),
    last_msg as (
      select distinct on (m.lead_id) m.lead_id, m.direction, m.created_at
      from chat_messages m
      where m.lead_id in (select id from cand)
        and m.sender is distinct from 'system'
      order by m.lead_id, m.created_at desc
    )
    select cand.id, cand.clinic_id, cand.name, cand.phone, cand.sla_alerted_at, cand.sla_min,
           lm.created_at as last_in,
           (select max(m2.created_at) from chat_messages m2
              where m2.lead_id = cand.id and m2.direction = 'outbound'
                and m2.sender is distinct from 'system') as last_out
    from cand
    join last_msg lm on lm.lead_id = cand.id
    join open_clinic oc on oc.clinic_id = cand.clinic_id
    where cand.sla_on and lm.direction = 'inbound'
      and lm.created_at < v_now - make_interval(mins => cand.sla_min)
  loop
    if r.sla_alerted_at is null or (r.last_out is not null and r.sla_alerted_at < r.last_out) then
      update leads set sla_alerted_at = v_now where id = r.id;
      perform notify_ops(r.clinic_id, 'nao_atendido',
        'Lead sem resposta há ' || r.sla_min || ' min',
        coalesce(nullif(btrim(r.name), ''), r.phone) || coalesce(' · ' || nullif(r.phone, ''), '') || E'\nNinguém respondeu ainda.',
        'warning', r.id, null, null, null, '{}'::jsonb, true, null);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('sla-unanswered', 'sla_failed', 'Falha no alerta de nao-atendido',
    'error', null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $$;

-- 4) Resposta de confirmação: system + GUC anti-dupla-resposta.
create or replace function public.fn_handle_confirmation_reply()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_content text; v_action text; v_cfg record; v_appt record;
  v_reply text; v_token text; v_number text;
  v_event text; v_title text; v_level text; v_new_status text;
begin
  if NEW.lead_id is null then return NEW; end if;
  v_content := lower(btrim(coalesce(NEW.message->>'content', '')));
  if v_content = '' then return NEW; end if;

  if v_content like '%confirmar consulta%' or v_content = 'confirmado' then
    v_action := 'confirmado';
  elsif v_content like '%remarcar consulta%' or v_content in ('remarcar','remarcado') then
    v_action := 'remarcado';
  elsif v_content like '%cancelar consulta%' or v_content = 'cancelado' then
    v_action := 'cancelado';
  else
    return NEW;
  end if;

  select confirm_native_enabled, confirm_post_message, confirm_reply_remarcado, confirm_reply_cancelado
    into v_cfg from ai_config where clinic_id = NEW.clinic_id;
  if v_cfg is null or v_cfg.confirm_native_enabled is not true then return NEW; end if;

  select a.id, a.date, a.time, p.name as patient_name
    into v_appt
    from appointments a
    join patients p on p.id = a.patient_id
    left join tickets t on t.id = a.ticket_id
   where a.clinic_id = NEW.clinic_id
     and a.reminder_sent_at is not null
     and a.status in ('pendente','confirmado')
     and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
     and (t.lead_id = NEW.lead_id or normalize_br_phone(p.phone) = normalize_br_phone(NEW.phone))
   order by a.reminder_sent_at desc
   limit 1;
  if v_appt.id is null then return NEW; end if;

  -- Tratado nativamente: o ingest desta MESMA transação lê o GUC e não encaminha à IA.
  perform set_config('app.confirmation_handled', 'on', true);

  if v_action = 'confirmado' then
    v_new_status := 'confirmado'; v_reply := v_cfg.confirm_post_message;
    v_event := 'confirmacao'; v_title := 'Consulta confirmada'; v_level := 'success';
  elsif v_action = 'cancelado' then
    v_new_status := 'cancelado'; v_reply := v_cfg.confirm_reply_cancelado;
    v_event := null; v_title := null; v_level := null;
  else
    v_new_status := null; v_reply := v_cfg.confirm_reply_remarcado;
    v_event := 'remarcacao'; v_title := 'Remarcação solicitada'; v_level := 'warning';
  end if;

  if v_new_status is not null then
    update appointments set status = v_new_status where id = v_appt.id;
  end if;

  if v_reply is not null and btrim(v_reply) <> '' then
    v_reply := replace(replace(replace(v_reply,
      '{paciente}', coalesce(v_appt.patient_name, '')),
      '{data}', to_char(v_appt.date, 'DD/MM/YYYY')),
      '{hora}', substr(v_appt.time::text, 1, 5));
    select api_token into v_token from whatsapp_instances where clinic_id = NEW.clinic_id limit 1;
    v_number := normalize_br_phone(NEW.phone);
    if v_token is not null and btrim(v_token) <> '' and v_number is not null then
      perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','token', v_token),
        jsonb_build_object('number', v_number, 'text', v_reply, 'delay', 0), 5000);
      insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
      values (NEW.clinic_id, NEW.lead_id, NEW.phone, 'outbound', 'system',
              jsonb_build_object('type','system','content', v_reply, 'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb));
    end if;
  end if;

  if v_event is not null then
    perform notify_ops(NEW.clinic_id, v_event, v_title,
      coalesce(v_appt.patient_name, 'Paciente') || ' — ' || to_char(v_appt.date,'DD/MM') || ' ' || substr(v_appt.time::text,1,5),
      v_level, NEW.lead_id, null, v_appt.id, null, jsonb_build_object('action', v_action), true, null);
  end if;
  return NEW;
exception when others then
  perform log_system_error('confirm-reply','confirm_reply_failed','Falha ao processar resposta de confirmação','error', NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false);
  return NEW;
end; $$;

-- 5) Encerramento: sender/type system.
create or replace function public.fn_ticket_finish_message()
returns trigger language plpgsql security definer set search_path to 'public' as $$
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
end; $$;

-- 6) Pós-atendimento: sender/type system.
create or replace function public.process_pos_followup()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_msg text; v_count integer := 0;
begin
  for r in
    select t.id as ticket_id, t.clinic_id, t.lead_id, t.outcome,
           normalize_br_phone(l.phone) as phone, l.name as lead_name,
           ai.pos_followup_ganho_message, ai.pos_followup_perdido_message, wa.api_token
    from tickets t
    join leads l on l.id = t.lead_id
    join ai_config ai on ai.clinic_id = t.clinic_id
    join whatsapp_instances wa on wa.clinic_id = t.clinic_id
    where t.outcome in ('ganho','perdido') and t.outcome_at is not null
      and t.pos_followup_sent_at is null and wa.status = 'connected'
      and coalesce(l.followup_enabled, true) = true and coalesce(l.is_not_lead, false) = false
      and ((t.outcome = 'ganho' and coalesce(ai.pos_followup_ganho_enabled,false)
            and t.outcome_at <= now() - (coalesce(ai.pos_followup_ganho_days,1) || ' days')::interval)
        or (t.outcome = 'perdido' and coalesce(ai.pos_followup_perdido_enabled,false)
            and t.outcome_at <= now() - (coalesce(ai.pos_followup_perdido_days,1) || ' days')::interval))
      and extract(hour from now() at time zone 'America/Sao_Paulo') >= 8
      and extract(hour from now() at time zone 'America/Sao_Paulo') < 20
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
end; $$;

-- 7) Lembrete de confirmação: registra na conversa como system (antes não aparecia).
create or replace function public.process_confirmation_reminders()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_msg text; v_count integer := 0;
begin
  for r in
    select a.id as appointment_id, a.clinic_id, a.ticket_id, p.name as paciente_nome,
           normalize_br_phone(p.phone) as phone,
           to_char(a.date,'DD/MM/YYYY') as data_consulta, to_char(a.time,'HH24:MI') as hora_consulta,
           ai.confirm_message, wa.api_token, t.lead_id
    from appointments a
    join patients p on a.patient_id = p.id
    join doctors d on a.doctor_id = d.id
    join ai_config ai on a.clinic_id = ai.clinic_id
    join whatsapp_instances wa on a.clinic_id = wa.clinic_id
    left join tickets t on t.id = a.ticket_id
    left join leads l on l.id = t.lead_id
    where ai.confirm_enabled = true and a.reminder_sent_at is null
      and a.status in ('pendente','confirmado') and wa.status = 'connected'
      and coalesce(l.followup_enabled, true) = true
      and ((a.date + a.time) at time zone 'America/Sao_Paulo') <= now() + (coalesce(ai.confirm_lead_time,1440) || ' minutes')::interval
      and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
      and extract(hour from now() at time zone 'America/Sao_Paulo') >= coalesce(ai.confirm_window_start, 6)
      and extract(hour from now() at time zone 'America/Sao_Paulo') <  coalesce(ai.confirm_window_end, 22)
  loop
    begin
      if r.phone is null or r.api_token is null or btrim(r.api_token) = '' then continue; end if;
      v_msg := replace(replace(replace(coalesce(r.confirm_message,''),
        '{paciente}', coalesce(r.paciente_nome,'')), '{data}', r.data_consulta), '{hora}', r.hora_consulta);

      perform system_http_post('https://med4growautomacao.uazapi.com/send/menu',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.phone, 'type', 'button', 'text', v_msg,
          'choices', jsonb_build_array('Confirmar consulta|confirmado','Remarcar consulta|remarcar','Cancelar consulta|cancelado'),
          'footerText', 'Por favor, clique em uma das opções abaixo.'),
        5000);

      if r.lead_id is not null then
        insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
        values (r.clinic_id, r.lead_id, r.phone, 'outbound', 'system',
                jsonb_build_object('type','system','content', 'CONFIRMAÇÃO: ' || v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));
      end if;

      update appointments set reminder_sent_at = (now() at time zone 'America/Sao_Paulo') where id = r.appointment_id;
      v_count := v_count + 1;
    exception when others then
      perform log_system_error('confirm-reminder','send_failed','Falha ao enviar lembrete de confirmação',
        'error', r.clinic_id, jsonb_build_object('appointment_id', r.appointment_id, 'detail', sqlerrm), false);
    end;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('confirm-reminder','job_failed','Falha no job de lembrete de confirmação','error',
    null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $$;

-- 8) ingest_wa_message: guard anti-dupla-resposta (GUC lido após o INSERT, mesma transação).
create or replace function public.ingest_wa_message(
  p_instance_token text, p_direction text, p_lead_phone text, p_content text,
  p_wa_message_id text default null, p_lead_name text default null, p_sender text default 'human',
  p_media_kind text default null, p_media_mime text default null, p_media_path text default null,
  p_media_filename text default null, p_media_duration numeric default null, p_avatar_url text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_clinic uuid; v_clinic_phone text; v_norm text; v_lead RECORD; v_lead_created boolean := false;
  v_msg_id uuid; v_duplicate boolean := false; v_cfg RECORD; v_forward boolean := false;
  v_message jsonb; v_incoming text; v_incoming_real boolean; v_avatar text := nullif(btrim(p_avatar_url), '');
begin
  if p_direction not in ('inbound','outbound') then
    return jsonb_build_object('success', false, 'error_code', 'invalid_direction');
  end if;

  select clinic_id, phone_number into v_clinic, v_clinic_phone
  from whatsapp_instances where api_token = p_instance_token limit 1;
  if v_clinic is null then
    return jsonb_build_object('success', false, 'error_code', 'instance_not_found');
  end if;

  v_norm := normalize_br_phone(p_lead_phone);
  if v_norm is null or length(v_norm) < 12 then
    return jsonb_build_object('success', false, 'error_code', 'invalid_phone');
  end if;

  v_incoming := nullif(btrim(p_lead_name), '');
  v_incoming_real := v_incoming is not null
    and lower(v_incoming) not in ('semnome','sem nome','contato')
    and v_incoming not like 'Lead %'
    and v_incoming !~ '^\+?[0-9][0-9\s\-]*$';

  select id, ai_enabled, is_not_lead, name into v_lead
  from leads where clinic_id = v_clinic and normalize_br_phone(phone) = v_norm
  order by last_activity_at desc nulls last limit 1;

  if v_lead.id is null and p_direction = 'inbound' then
    begin
      insert into leads (clinic_id, name, phone, source, capture_channel, avatar_url)
      values (v_clinic, case when v_incoming_real then v_incoming else 'Lead ' || v_norm end, v_norm, null, 'whatsapp', v_avatar)
      returning id, ai_enabled, is_not_lead, name into v_lead;
      v_lead_created := true;
    exception when unique_violation then
      select id, ai_enabled, is_not_lead, name into v_lead
      from leads where clinic_id = v_clinic and (phone = v_norm or normalize_br_phone(phone) = v_norm)
      order by last_activity_at desc nulls last limit 1;
    end;
  end if;

  if v_lead.id is not null and not v_lead_created then
    if v_incoming_real and (
         v_lead.name is null or btrim(v_lead.name) = ''
         or lower(v_lead.name) in ('semnome','sem nome','contato')
         or v_lead.name like 'Lead %') then
      update leads set name = v_incoming where id = v_lead.id;
    end if;
    if v_avatar is not null then
      update leads set avatar_url = v_avatar where id = v_lead.id and avatar_url is distinct from v_avatar;
    end if;
  end if;

  v_message := jsonb_build_object(
    'type', case when p_sender = 'ai' then 'ai' else 'human' end,
    'content', coalesce(p_content, ''),
    'additional_kwargs', '{}'::jsonb, 'response_metadata', '{}'::jsonb);
  if p_media_path is not null then
    v_message := v_message || jsonb_strip_nulls(jsonb_build_object(
      'kind', p_media_kind, 'mimetype', p_media_mime, 'fileURL', p_media_path,
      'filename', p_media_filename, 'duration', p_media_duration));
  end if;

  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, wa_message_id, message, metadata)
  values (v_clinic, v_lead.id, v_norm, p_direction, p_sender, nullif(btrim(p_wa_message_id), ''), v_message,
    case when p_media_path is not null
      then jsonb_strip_nulls(jsonb_build_object('kind',p_media_kind,'mime',p_media_mime,'storagePath',p_media_path,'filename',p_media_filename))
      else '{}'::jsonb end)
  returning id into v_msg_id;
  if v_msg_id is null then v_duplicate := true; end if;

  select auto_schedule, response_wait_seconds, handoff_enabled, handoff_rules,
         confirm_enabled, transition_rules, test_mode_enabled, test_numbers
    into v_cfg from ai_config where clinic_id = v_clinic;

  v_forward := p_direction = 'inbound' and not v_duplicate
    and v_lead.id is not null and v_lead.ai_enabled is not false
    and coalesce(v_lead.is_not_lead, false) = false
    and coalesce(v_cfg.auto_schedule, false)
    and coalesce(current_setting('app.confirmation_handled', true), '') <> 'on'
    and (coalesce(v_cfg.test_mode_enabled, false) = false
         or exists (select 1 from unnest(coalesce(v_cfg.test_numbers, array[]::text[])) tn
                    where normalize_br_phone(tn) = v_norm));

  return jsonb_build_object(
    'success', true, 'clinic_id', v_clinic, 'clinic_phone', v_clinic_phone,
    'lead_id', v_lead.id, 'lead_created', v_lead_created, 'message_id', v_msg_id,
    'duplicate', v_duplicate, 'forward_ai', v_forward,
    'ai', jsonb_build_object(
      'response_wait_seconds', coalesce(v_cfg.response_wait_seconds, 30),
      'handoff_enabled', coalesce(v_cfg.handoff_enabled, false),
      'handoff_rules', coalesce(v_cfg.handoff_rules, '[]'::jsonb),
      'confirm_enabled', coalesce(v_cfg.confirm_enabled, false),
      'transition_rules', coalesce(v_cfg.transition_rules, '[]'::jsonb)));
end;
$function$;

-- 9) Dashboards: system fora do stream de tempo-de-resposta (patch cirúrgico, idempotente).
do $$
declare r record; src text; pat text; rep text; patched int := 0;
begin
  pat := 'WHEN cm.direction = ''outbound'' THEN ''out''';
  rep := 'WHEN cm.direction = ''outbound'' AND cm.sender <> ''system'' THEN ''out''';
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_dashboard_stats' loop
    src := pg_get_functiondef(r.oid);
    if position(rep in src) > 0 then continue; end if;
    if position(pat in src) = 0 then raise exception 'get_dashboard_stats: padrao nao encontrado'; end if;
    execute replace(src, pat, rep);
    patched := patched + 1;
  end loop;

  pat := 'WHEN (p_agent = ''todos'' AND cm.direction = ''outbound'')';
  rep := 'WHEN (p_agent = ''todos'' AND cm.direction = ''outbound'' AND cm.sender <> ''system'')';
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_commercial_dashboard' loop
    src := pg_get_functiondef(r.oid);
    if position(rep in src) > 0 then continue; end if;
    if position(pat in src) = 0 then raise exception 'get_commercial_dashboard: padrao nao encontrado'; end if;
    execute replace(src, pat, rep);
    patched := patched + 1;
  end loop;
  raise notice 'dashboards patched: %', patched;
end $$;
