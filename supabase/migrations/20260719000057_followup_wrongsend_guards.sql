-- Fecha as brechas de envio errado da auditoria (followup-rules-audit), das mais graves p/ as menores.
--
-- ALTA-1  Encerramento sem dedup  -> coluna finish_message_event + carimbo (não reenvia mesmo evento).
-- ALTA-2  Reengajamento sem 'connected' (queima o passo) -> selector exige status='connected'.
-- ALTA-3  Pós manda p/ quem VOLTOU -> suprime se há ticket aberto do lead OU inbound após outcome_at.
-- MÉDIA-4 Encerramento ignora followup_enabled/is_not_lead -> passa a respeitar (horário: ver nota).
-- MÉDIA-5 send_blocked_until só no welcome -> aplicado a reengaj/pós/confirm/encerramento.
-- BAIXA-7 Confirmação envia msg vazia -> skip se confirm_message em branco.
-- BAIXA-9 Welcome não exclui is_not_lead -> passa a excluir.
-- (MÉDIA-6 é re-check no edge reengagement-followup; BAIXA-8 'já confirmado' é decisão de produto: mantido.)

-- ---------------------------------------------------------------------------
-- ALTA-1 dedup do encerramento
-- ---------------------------------------------------------------------------
alter table public.tickets
  add column if not exists finish_message_event text,
  add column if not exists finish_message_sent_at timestamptz;

comment on column public.tickets.finish_message_event is
  'Último evento de encerramento cujo texto já foi enviado p/ este ticket (ganho|perdido|service). Dedup: mesmo evento não reenvia.';

-- ---------------------------------------------------------------------------
-- ENCERRAMENTO: dedup + respeita mute/não-lead + WhatsApp conectado/não-bloqueado
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

  -- ALTA-1: não reenvia a MESMA mensagem de encerramento p/ o mesmo ticket
  -- (reabrir+re-fechar no mesmo outcome, toggle repetido). Eventos diferentes ainda enviam.
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

  -- MÉDIA-4: respeita mute do lead e não-lead
  select normalize_br_phone(phone), name, coalesce(is_not_lead,false), coalesce(followup_enabled,true)
    into v_phone, v_name, v_is_not_lead, v_fu_enabled
    from leads where id = NEW.lead_id;
  if v_phone is null then return NEW; end if;
  if v_is_not_lead then return NEW; end if;
  if not v_fu_enabled then return NEW; end if;

  -- MÉDIA-5: WhatsApp conectado e não bloqueado
  select status, api_token, send_blocked_until
    into v_wa_status, v_token, v_blocked
    from whatsapp_instances where clinic_id = NEW.clinic_id
    order by (status = 'connected') desc nulls last limit 1;
  if v_token is null or btrim(v_token) = '' then return NEW; end if;
  if v_wa_status is distinct from 'connected' then return NEW; end if;
  if v_blocked is not null and v_blocked > now() then return NEW; end if;

  -- NOTA: encerramento NÃO tem trava de horário DE PROPÓSITO. É gatilho de disparo único na
  -- transição; barrar por horário DESCARTARIA a mensagem (sem re-tentativa, ao contrário dos crons).

  v_msg := replace(replace(v_msg, '{paciente}', coalesce(v_name, '')), '{nome}', coalesce(v_name, ''));

  perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
    jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
    jsonb_build_object('number', v_phone, 'text', v_msg, 'delay', 0), 5000);

  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
  values (NEW.clinic_id, NEW.lead_id, v_phone, 'outbound', 'system',
          jsonb_build_object('type','system','content', v_prefix || v_msg,
                             'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

  -- Carimba o evento enviado (dedup). keep_ticket_outcome garante que este UPDATE não zere o outcome
  -- caso o enforce ainda esteja no default destrutivo; no default preserve é ignorado (inócuo).
  perform set_config('app.keep_ticket_outcome', 'on', true);
  update tickets set finish_message_event = v_event, finish_message_sent_at = now() where id = NEW.id;

  return NEW;
exception when others then
  perform log_system_error('encerramento','finish_send_failed','Falha ao enviar mensagem de encerramento',
    'error', NEW.clinic_id, jsonb_build_object('ticket_id', NEW.id, 'event', v_event, 'detail', sqlerrm), false);
  return NEW;
end; $function$;

-- ---------------------------------------------------------------------------
-- REENGAJAMENTO: WhatsApp conectado + não-bloqueado (ALTA-2 + MÉDIA-5)
-- ---------------------------------------------------------------------------
create or replace function public.process_reengagement_followup()
 returns void
 language plpgsql
as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/reengagement-followup';
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
  v_payload jsonb;
begin
  for r in
    with elegiveis as (
      select l.id, l.name, l.phone, l.clinic_id, l.followup_count,
             w.phone_number as clinic_phone,
             s.message_text, s.step_no, s.is_closing,
             row_number() over (partition by l.clinic_id order by lm.last_at asc) as rn
      from public.leads l
      join public.ai_config ac on ac.clinic_id = l.clinic_id
      join public.followup_steps s
        on s.clinic_id = l.clinic_id
       and s.step_no = l.followup_count + 1
       and s.enabled = true
      join lateral (
        select wi.phone_number, wi.api_token, wi.status, wi.send_blocked_until
        from public.whatsapp_instances wi
        where wi.clinic_id = l.clinic_id
        order by (wi.status = 'connected') desc nulls last
        limit 1
      ) w on true
      join lateral (
        select cm.direction as last_dir, cm.created_at as last_at
        from public.chat_messages cm
        where cm.lead_id = l.id
        order by cm.seq desc
        limit 1
      ) lm on true
      where ac.followup_enabled = true
        and l.followup_enabled = true
        and l.ai_enabled = true
        and l.handoff_triggered_at is null
        and l.converted_patient_id is null
        and coalesce(l.is_not_lead, false) = false
        and w.api_token is not null
        -- ALTA-2 + MÉDIA-5: só clínica com WhatsApp conectado e sem bloqueio de envio
        and w.status = 'connected'
        and (w.send_blocked_until is null or w.send_blocked_until <= now())
        and l.phone is not null and l.phone <> ''
        and v_hour >= coalesce(ac.followup_window_start, 6)
        and v_hour <  coalesce(ac.followup_window_end, 22)
        and not exists (
          select 1 from public.tickets t
          where t.lead_id = l.id and t.outcome = 'ganho'
        )
        and exists (
          select 1 from public.tickets t
          join public.funnel_stages fs on fs.id = t.stage_id
          where t.lead_id = l.id and t.status = 'open'
            and fs.slug not in ('agendado','compareceu','ganho','perdido')
        )
        and lm.last_dir = 'outbound'
        and lm.last_at < (v_now - (s.delay_minutes || ' minutes')::interval)
        and lm.last_at >= (v_now - (coalesce(ac.followup_max_idle_days, 7) || ' days')::interval)
        and (l.followup_sent_at is null or l.followup_sent_at < (v_now - (s.delay_minutes || ' minutes')::interval))
    )
    select id, name, phone, clinic_id, followup_count, clinic_phone, message_text, step_no, is_closing
    from elegiveis
    where rn <= v_max_per_clinic
  loop
    v_payload := jsonb_build_object(
      'lead_id',        r.id,
      'clinic_id',      r.clinic_id,
      'name',           r.name,
      'phone',          r.phone,
      'clinic_phone',   r.clinic_phone,
      'message_text',   r.message_text,
      'step_no',        r.step_no,
      'is_closing',     r.is_closing,
      'expected_count', r.followup_count
    );
    perform public.system_http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := v_payload
    );
  end loop;
end;
$function$;

-- ---------------------------------------------------------------------------
-- PÓS-ATENDIMENTO: não envia se o lead VOLTOU + send_blocked (ALTA-3 + MÉDIA-5)
-- (mantém cap de vencimento, rate-limit e expiração da migration anterior)
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
        and (wa.send_blocked_until is null or wa.send_blocked_until <= now())   -- MÉDIA-5
        and coalesce(l.followup_enabled, true) = true and coalesce(l.is_not_lead, false) = false
        -- ALTA-3: não manda p/ quem VOLTOU (tem ticket aberto novo, ou respondeu após o fechamento)
        and not exists (
          select 1 from tickets t2 where t2.lead_id = t.lead_id and t2.status = 'open'
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
-- CONFIRMAÇÃO: não envia msg vazia + send_blocked (BAIXA-7 + MÉDIA-5)
-- ---------------------------------------------------------------------------
create or replace function public.process_confirmation_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
      and (wa.send_blocked_until is null or wa.send_blocked_until <= now())          -- MÉDIA-5
      and nullif(btrim(ai.confirm_message), '') is not null                          -- BAIXA-7
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
end; $function$;

-- ---------------------------------------------------------------------------
-- BOAS-VINDAS: exclui is_not_lead (BAIXA-9)
-- ---------------------------------------------------------------------------
create or replace function public.process_forms_followup()
 returns void
 language plpgsql
as $function$
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
              AND coalesce(l.is_not_lead, false) = false            -- BAIXA-9
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
