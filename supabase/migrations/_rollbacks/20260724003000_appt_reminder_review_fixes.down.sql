-- Rollback das correções do review. Restaura o reengajamento original (sem a exclusão por consulta
-- futura), volta as funções do Lembrete ao estado da 20260723235500, remove o índice e o helper.

-- reengajamento: versão original (sem o gate de consulta futura).
create or replace function public.fn_followup_candidates_reengagement(p_clinic_id uuid default null)
 returns table(clinic_id uuid, lead_id uuid, nome text, telefone text, clinic_phone text, message_text text, step_no integer, is_closing boolean, expected_count integer, eligible_at timestamp without time zone, toggle_on boolean, wa_ok boolean, window_start integer, window_end integer)
 language sql stable set search_path to 'public'
as $function$
  select
    l.clinic_id, l.id, l.name, l.phone,
    w.phone_number, s.message_text, s.step_no, s.is_closing, l.followup_count,
    (greatest(lm.last_at, coalesce(l.followup_sent_at, lm.last_at))
       + (s.delay_minutes || ' minutes')::interval)::timestamp,
    coalesce(ac.followup_enabled, false),
    ss.send_token is not null,
    coalesce(ac.followup_window_start, 6), coalesce(ac.followup_window_end, 22)
  from leads l
  join ai_config ac on ac.clinic_id = l.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = l.clinic_id
  join followup_steps s
    on s.clinic_id = l.clinic_id and s.step_no = l.followup_count + 1 and s.enabled = true
  join lateral (
    select wi.phone_number from whatsapp_instances wi where wi.clinic_id = l.clinic_id
     order by (wi.status = 'connected') desc nulls last limit 1
  ) w on true
  join lateral (
    select cm.direction as last_dir, cm.created_at as last_at
      from chat_messages cm where cm.lead_id = l.id
     order by cm.seq desc limit 1
  ) lm on true
  where (p_clinic_id is null or l.clinic_id = p_clinic_id)
    and l.followup_enabled = true
    and l.ai_enabled = true
    and l.handoff_triggered_at is null
    and l.converted_patient_id is null
    and coalesce(l.is_not_lead, false) = false
    and l.phone is not null and l.phone <> ''
    and not exists (select 1 from tickets t where t.lead_id = l.id and t.outcome = 'ganho')
    and exists (select 1 from tickets t join funnel_stages fs on fs.id = t.stage_id
                 where t.lead_id = l.id and t.status = 'open'
                   and fs.slug not in ('agendado','compareceu','ganho','perdido'))
    and lm.last_dir = 'outbound'
    and lm.last_at >= ((now() at time zone 'America/Sao_Paulo')
                        - (coalesce(ac.followup_max_idle_days, 7) || ' days')::interval)
$function$;
revoke all on function public.fn_followup_candidates_reengagement(uuid) from public;

drop index if exists public.ix_appt_reminder_pending;

-- candidato do Lembrete: volta à fórmula inline, sem is_not_lead.
create or replace function public.fn_followup_candidates_appt_reminder(p_clinic_id uuid default null)
returns table (
  clinic_id uuid, appointment_id uuid, lead_id uuid, nome text, telefone text,
  data_consulta text, hora_consulta text, medico text, message text,
  eligible_at timestamp, expires_at timestamp, toggle_on boolean, wa_ok boolean,
  window_start int, window_end int
)
language sql stable set search_path to 'public' as $$
  select
    a.clinic_id, a.id, t.lead_id, p.name, normalize_br_phone(p.phone),
    to_char(a.date,'DD/MM/YYYY'), to_char(a."time",'HH24:MI'), d.name, ai.appt_reminder_message,
    ((a.date + a."time") - (coalesce(ai.appt_reminder_lead_time, 120) || ' minutes')::interval)::timestamp,
    least(
      ((a.date + a."time") - (coalesce(ai.appt_reminder_lead_time, 120) || ' minutes')::interval)
        + (coalesce(ai.appt_reminder_grace_minutes, 60) || ' minutes')::interval,
      (a.date + a."time")
    )::timestamp,
    coalesce(ai.appt_reminder_enabled, false),
    ss.send_token is not null,
    coalesce(ai.appt_reminder_window_start, 8), coalesce(ai.appt_reminder_window_end, 20)
  from appointments a
  join patients p on p.id = a.patient_id
  join doctors  d on d.id = a.doctor_id
  join ai_config ai on ai.clinic_id = a.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = a.clinic_id
  left join tickets t on t.id = a.ticket_id
  left join leads   l on l.id = t.lead_id
  where (p_clinic_id is null or a.clinic_id = p_clinic_id)
    and a.appt_reminder_sent_at is null
    and a.appt_reminder_expired_at is null
    and a.status in ('pendente','confirmado')
    and (a.status = 'confirmado' or not coalesce(ai.appt_reminder_only_confirmed, false))
    and nullif(btrim(ai.appt_reminder_message), '') is not null
    and coalesce(l.followup_enabled, true) = true
    and ((a.date + a."time") at time zone 'America/Sao_Paulo') > now()
    and normalize_br_phone(p.phone) is not null
$$;
revoke all on function public.fn_followup_candidates_appt_reminder(uuid) from public;

-- motor do Lembrete: volta ao dedup só-appointment_id, filtro wa_ok e vencimento inline.
create or replace function public.process_appointment_reminders()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; v_msg text; v_token text; v_count integer := 0; v_expired integer := 0;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  with expired as (
    update public.appointments a set appt_reminder_expired_at = (now() at time zone 'America/Sao_Paulo')
      from public.ai_config ai
     where ai.clinic_id = a.clinic_id
       and coalesce(ai.appt_reminder_enabled, false)
       and a.status in ('pendente','confirmado')
       and a.appt_reminder_sent_at is null
       and a.appt_reminder_expired_at is null
       and least(
             ((a.date + a."time") - (coalesce(ai.appt_reminder_lead_time,120) || ' minutes')::interval)
               + (coalesce(ai.appt_reminder_grace_minutes,60) || ' minutes')::interval,
             (a.date + a."time")
           ) < (now() at time zone 'America/Sao_Paulo')
    returning 1
  )
  select count(*) into v_expired from expired;

  if v_expired > 0 then
    perform log_system_error('appt-reminder','expired_suppressed',
      'Lembrete de consulta retirado da fila por vencimento (passou da tolerância de atraso)','info',
      null, jsonb_build_object('count', v_expired), false);
  end if;

  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_appt_reminder() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at <= v_now and c.expires_at >= v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    begin
      v_msg := replace(replace(replace(replace(coalesce(r.message,''),
        '{paciente}', coalesce(r.nome,'')),
        '{data}', r.data_consulta),
        '{hora}', r.hora_consulta),
        '{medico}', coalesce(r.medico,''));
      if btrim(v_msg) = '' then
        update appointments set appt_reminder_sent_at = (now() at time zone 'America/Sao_Paulo') where id = r.appointment_id;
        continue;
      end if;

      if public.fn_emissor_ativo(r.clinic_id) then
        perform public.emit_message(
          p_clinic_id => r.clinic_id, p_to_addr => r.telefone, p_producer => 'appt_reminder',
          p_body => v_msg, p_lead_id => r.lead_id,
          p_dedup_key => 'appt_reminder:' || r.appointment_id::text,
          p_chat_payload => case when r.lead_id is not null then
            jsonb_build_object('sender','system',
              'message', jsonb_build_object('type','system','content', v_msg,
                         'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb))
            else null end);
        update appointments set appt_reminder_sent_at = (now() at time zone 'America/Sao_Paulo') where id = r.appointment_id;
        v_count := v_count + 1;
      else
        v_token := fn_clinic_send_token(r.clinic_id);
        if v_token is null then continue; end if;
        perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
          jsonb_build_object('Content-Type','application/json','token', v_token),
          jsonb_build_object('number', r.telefone, 'text', v_msg, 'delay', 0), 5000);
        if r.lead_id is not null then
          insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
          values (r.clinic_id, r.lead_id, r.telefone, 'outbound', 'system',
                  jsonb_build_object('type','system','content', v_msg, 'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb));
        end if;
        update appointments set appt_reminder_sent_at = (now() at time zone 'America/Sao_Paulo') where id = r.appointment_id;
        v_count := v_count + 1;
      end if;
    exception when others then
      perform log_system_error('appt-reminder','send_failed','Falha ao enviar lembrete de consulta',
        'error', r.clinic_id, jsonb_build_object('appointment_id', r.appointment_id, 'detail', sqlerrm), false);
    end;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('appt-reminder','job_failed','Falha no job de lembrete de consulta','error',
    null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $function$;

drop function if exists public.fn_appt_reminder_expires(timestamp,int,int);
