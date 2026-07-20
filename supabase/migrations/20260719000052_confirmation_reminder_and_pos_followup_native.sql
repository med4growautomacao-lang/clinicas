-- Followup nativo: (A) lembrete de confirmação de consulta (substitui n8n "Envio de Confirmação",
-- desativado) e (B) pós-atendimento (nunca foi nativo). Crons varrem candidatos + enviam via
-- system_http_post + dedup. (A) usa /send/menu com botões (Confirmar/Remarcar/Cancelar) — a resposta
-- nativa (fn_handle_confirmation_reply) casa nesses textos. Espelham os gates do n8n.

-- Dedup do pós-atendimento (1 envio por ticket resolvido).
alter table public.tickets add column if not exists pos_followup_sent_at timestamptz;

-- (A) LEMBRETE DE CONFIRMAÇÃO -------------------------------------------------------------------
create or replace function public.process_confirmation_reminders()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_msg text; v_count integer := 0;
begin
  for r in
    select a.id as appointment_id, a.clinic_id, p.name as paciente_nome,
           normalize_br_phone(p.phone) as phone,
           to_char(a.date,'DD/MM/YYYY') as data_consulta,
           to_char(a.time,'HH24:MI') as hora_consulta,
           ai.confirm_message, wa.api_token
    from appointments a
    join patients p on a.patient_id = p.id
    join doctors d on a.doctor_id = d.id
    join ai_config ai on a.clinic_id = ai.clinic_id
    join whatsapp_instances wa on a.clinic_id = wa.clinic_id
    left join tickets t on t.id = a.ticket_id
    left join leads l on l.id = t.lead_id
    where ai.confirm_enabled = true
      and a.reminder_sent_at is null
      and a.status in ('pendente','confirmado')
      and wa.status = 'connected'
      and coalesce(l.followup_enabled, true) = true
      and ((a.date + a.time) at time zone 'America/Sao_Paulo') <= now() + (coalesce(ai.confirm_lead_time,1440) || ' minutes')::interval
      and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
      and extract(hour from now() at time zone 'America/Sao_Paulo') >= 6
      and extract(hour from now() at time zone 'America/Sao_Paulo') < 22
  loop
    begin
      if r.phone is null or r.api_token is null or btrim(r.api_token) = '' then continue; end if;
      v_msg := replace(replace(replace(coalesce(r.confirm_message,''),
        '{paciente}', coalesce(r.paciente_nome,'')),
        '{data}', r.data_consulta),
        '{hora}', r.hora_consulta);

      perform system_http_post(
        'https://med4growautomacao.uazapi.com/send/menu',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.phone, 'type', 'button', 'text', v_msg,
          'choices', jsonb_build_array('Confirmar consulta|confirmado','Remarcar consulta|remarcar','Cancelar consulta|cancelado'),
          'footerText', 'Por favor, clique em uma das opções abaixo.'),
        5000);

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

-- (B) PÓS-ATENDIMENTO ---------------------------------------------------------------------------
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
    where t.outcome in ('ganho','perdido')
      and t.outcome_at is not null
      and t.pos_followup_sent_at is null
      and wa.status = 'connected'
      and coalesce(l.followup_enabled, true) = true
      and coalesce(l.is_not_lead, false) = false
      and (
        (t.outcome = 'ganho'   and coalesce(ai.pos_followup_ganho_enabled,false)
          and t.outcome_at <= now() - (coalesce(ai.pos_followup_ganho_days,1)   || ' days')::interval)
        or
        (t.outcome = 'perdido' and coalesce(ai.pos_followup_perdido_enabled,false)
          and t.outcome_at <= now() - (coalesce(ai.pos_followup_perdido_days,1) || ' days')::interval)
      )
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

      perform system_http_post(
        'https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.phone, 'text', v_msg, 'delay', 0),
        5000);

      insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
      values (r.clinic_id, r.lead_id, r.phone, 'outbound', 'ai',
              jsonb_build_object('type','ai','content', v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

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

-- Crons (SP: expediente checado dentro das funções).
select cron.schedule('confirmation_reminder_job', '* * * * *',  'select public.process_confirmation_reminders()');
select cron.schedule('pos_followup_job',          '*/15 * * * *', 'select public.process_pos_followup()');
