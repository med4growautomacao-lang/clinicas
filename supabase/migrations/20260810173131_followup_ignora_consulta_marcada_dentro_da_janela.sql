-- REGRA (decisao do dono, 10/08): consulta MARCADA (ou remarcada) quando a janela de envio JA
-- PASSOU nao recebe confirmacao nem lembrete. Quem acabou de marcar sabe a data; pedir confirmacao
-- segundos depois de agendar e ruido, e no encaixe de recepcao chega a ser confuso.
--
-- Medido em 90 dias nas clinicas com a chave ligada: Clinica Vaz 17 de 104 consultas (1 em cada 6)
-- caiam nesse caso na confirmacao e MedDesk Demonstrativa 9 de 47. No lembrete, 1 na Vaz e 1 na
-- Lorena. Hoje isso disparava na varredura seguinte, ou seja, na hora.
--
-- Marco temporal: `schedule_set_at` = quando o HORARIO foi definido. Fica NULL no insert e o
-- fallback e `created_at` (mesmo instante), entao nao precisa backfill nem UPDATE em massa. O
-- gatilho que ja existe para rearmar o lembrete passa a carimbar a coluna quando a data ou a hora
-- muda, e com isso a regra vale igual para MARCAR e para REMARCAR: se o horario foi definido ja
-- dentro da janela, nao envia.
-- ⚠️ Sem esse marco, `created_at` sozinho deixaria o caso REMARCAR de fora, e esse ja e um caminho
-- vivo: o lembrete rearma na remarcacao, entao mover uma consulta para daqui a 90 minutos disparava
-- lembrete imediato.
--
-- ⚠️ Tipos: `created_at`, `schedule_set_at`, `date` e `time` sao todos SEM fuso (ja em Sao Paulo),
-- entao a comparacao e direta. Nao meter AT TIME ZONE aqui, deslocaria 3h.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS schedule_set_at timestamp without time zone;

COMMENT ON COLUMN public.appointments.schedule_set_at IS
  'Quando o horario da consulta foi definido pela ultima vez (marcacao ou remarcacao). NULL = nunca remarcada, vale created_at. Usada para nao enviar confirmacao/lembrete de consulta marcada dentro da propria janela de envio.';

-- Carimba o marco na remarcacao, no MESMO gatilho que ja rearma o lembrete.
CREATE OR REPLACE FUNCTION public.fn_appt_rearm_reminder()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if (NEW.date, NEW."time") is distinct from (OLD.date, OLD."time") then
    NEW.appt_reminder_sent_at    := null;
    NEW.appt_reminder_expired_at := null;
    NEW.schedule_set_at          := now() at time zone 'America/Sao_Paulo';
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_followup_candidates_confirmation(p_clinic_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(clinic_id uuid, appointment_id uuid, lead_id uuid, nome text, telefone text, data_consulta text, hora_consulta text, confirm_message text, eligible_at timestamp without time zone, toggle_on boolean, wa_ok boolean, window_start integer, window_end integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    a.clinic_id, a.id, t.lead_id, p.name, normalize_br_phone(p.phone),
    to_char(a.date,'DD/MM/YYYY'), to_char(a.time,'HH24:MI'), ai.confirm_message,
    ((a.date + a.time) - (coalesce(ai.confirm_lead_time, 1440) || ' minutes')::interval)::timestamp,
    coalesce(ai.confirm_enabled, false),
    ss.send_token is not null,
    coalesce(ai.confirm_window_start, 6), coalesce(ai.confirm_window_end, 22)
  from appointments a
  join patients p on p.id = a.patient_id
  join doctors d on d.id = a.doctor_id
  join ai_config ai on ai.clinic_id = a.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = a.clinic_id
  left join tickets t on t.id = a.ticket_id
  left join leads   l on l.id = t.lead_id
  where (p_clinic_id is null or a.clinic_id = p_clinic_id)
    and a.reminder_sent_at is null
    and a.status in ('pendente','confirmado')
    and nullif(btrim(ai.confirm_message), '') is not null
    and coalesce(l.followup_enabled, true) = true
    -- opt-out por tipo (lead_followup_optout)
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'confirmation')
    and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
    -- marcada/remarcada JA dentro da janela de envio: quem acabou de agendar sabe a data
    and coalesce(a.schedule_set_at, a.created_at)
          <= ((a.date + a.time) - (coalesce(ai.confirm_lead_time, 1440) || ' minutes')::interval)
    and normalize_br_phone(p.phone) is not null
$function$;

CREATE OR REPLACE FUNCTION public.fn_followup_candidates_appt_reminder(p_clinic_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(clinic_id uuid, appointment_id uuid, lead_id uuid, nome text, telefone text, data_consulta text, hora_consulta text, medico text, message text, eligible_at timestamp without time zone, expires_at timestamp without time zone, toggle_on boolean, wa_ok boolean, window_start integer, window_end integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    a.clinic_id, a.id, t.lead_id, p.name, normalize_br_phone(p.phone),
    to_char(a.date,'DD/MM/YYYY'), to_char(a."time",'HH24:MI'), d.name, ai.appt_reminder_message,
    ((a.date + a."time") - (coalesce(ai.appt_reminder_lead_time, 120) || ' minutes')::interval)::timestamp,
    fn_appt_reminder_expires((a.date + a."time"), ai.appt_reminder_lead_time, ai.appt_reminder_grace_minutes),
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
    -- opt-out por tipo (lead_followup_optout)
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'appt_reminder')
    and coalesce(l.is_not_lead, false) = false
    and ((a.date + a."time") at time zone 'America/Sao_Paulo') > now()
    -- marcada/remarcada JA dentro da janela de envio: quem acabou de agendar sabe a data
    and coalesce(a.schedule_set_at, a.created_at)
          <= ((a.date + a."time") - (coalesce(ai.appt_reminder_lead_time, 120) || ' minutes')::interval)
    and normalize_br_phone(p.phone) is not null
$function$;

-- A varredura de vencimento tambem ignora esses casos: sem isto o job marcaria
-- `appt_reminder_expired_at` e acenderia "retirado da fila por vencimento" na Central para algo que
-- nunca esteve na fila, transformando uma decisao de produto em alarme.
CREATE OR REPLACE FUNCTION public.process_appointment_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and coalesce(a.schedule_set_at, a.created_at)
             <= ((a.date + a."time") - (coalesce(ai.appt_reminder_lead_time, 120) || ' minutes')::interval)
       and fn_appt_reminder_expires((a.date + a."time"), ai.appt_reminder_lead_time, ai.appt_reminder_grace_minutes)
             < (now() at time zone 'America/Sao_Paulo')
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
       where c.toggle_on
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
          p_dedup_key => 'appt_reminder:' || r.appointment_id::text || ':' || r.data_consulta || ' ' || r.hora_consulta,
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
