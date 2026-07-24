-- LEMBRETE DE CONSULTA — motor. Mesma anatomia dos outros 4 follow-ups:
--   fn_followup_candidates_appt_reminder = gates duráveis + eligible_at/expires_at + toggle/wa_ok/janela como COLUNAS (fonte única lida pelo motor E pelo preview)
--   process_appointment_reminders        = vencimento (escrita), corte de tempo, janela de horário, cap por rodada, envio
--   ramo 'appt_reminder' no preview_followup_activation = a trava de ativação
--
-- ENVIO PELO EMISSOR, atrás da chave fn_emissor_ativo (padrão dos 4 irmãos migrados em 23/07):
-- clínica com a chave → emit_message (gate de token, entrega confirmada, retry, chat só após o 200);
-- clínica sem a chave → caminho inline (fn_clinic_send_token + system_http_post), idêntico ao pós.
-- O Lembrete é texto puro, então cabe nativo no Emissor (a Confirmação não coube: usa menu/botões).

-- ============================================================ candidatos
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
    -- linha não enviável não ocupa slot do cap
    and normalize_br_phone(p.phone) is not null
$$;

-- ============================================================ motor
create or replace function public.process_appointment_reminders()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; v_msg text; v_token text; v_count integer := 0; v_expired integer := 0;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  -- Vencimento é escrita, então fica no motor (a fonte única é só leitura). Só clínica LIGADA vence
  -- (clínica desligada não escreve nada). Passou da tolerância = sai da fila e vira log 'info'.
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
        -- EMISSOR: enfileira (worker resolve token, normaliza telefone, confirma entrega e só então
        -- grava na conversa via chat_payload). dedup_key = idempotência se o cron sobrepuser.
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
        -- Caminho antigo (chave desligada): gate inline + envio direto, como o pós.
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

-- ============================================================ preview (mesma fonte)
-- Recriada com o ramo 'appt_reminder'. O resto é byte-a-byte a versão atual (fonte 20260721000022).
create or replace function public.preview_followup_activation(
  p_clinic_id uuid,
  p_kind      text
) returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour  int       := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_ac    ai_config%rowtype;
  v_wa    record;
  v_in_window boolean := true;
  v_wa_ok  boolean := false;
  v_cap    int := null;  v_tick int := null;
  v_is_trigger boolean := false;
  v_agora int := 0; v_horas int := 0; v_dias int := 0; v_total_7d int := 0;
  v_sample jsonb := '[]'::jsonb;
  v_hist   int := null;
  v_win_start int; v_win_end int;
  v_drain  int := 0;
begin
  if not (
      is_super_admin()
      or is_clinic_admin(p_clinic_id)
      or exists (select 1 from clinic_users cu where cu.id = auth.uid() and cu.clinic_id = p_clinic_id)
      or exists (select 1 from clinics c join org_users ou on ou.organization_id = c.organization_id
                 where c.id = p_clinic_id and ou.user_id = auth.uid())
  ) then
    raise exception 'Sem permissão para esta clínica';
  end if;

  select * into v_ac from ai_config where clinic_id = p_clinic_id;

  select wi.status, wi.send_blocked_until into v_wa
    from whatsapp_instances wi where wi.clinic_id = p_clinic_id
   order by (wi.status = 'connected') desc nulls last limit 1;

  -- mesma definição que os motores usam
  v_wa_ok := fn_clinic_can_send(p_clinic_id);

  create temp table if not exists _fu_prev (
    lead_id uuid, nome text, telefone text, quando timestamp, detalhe text
  ) on commit drop;
  -- TRUNCATE e não DELETE: na sessão do PostgREST o safe-updates recusa DELETE sem WHERE.
  truncate table _fu_prev;

  if p_kind = 'welcome' then
    v_cap := 3; v_tick := 1;
    v_win_start := coalesce(v_ac.welcome_window_start, 6);
    v_win_end   := coalesce(v_ac.welcome_window_end, 22);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at, 'lead de formulário'
      from fn_followup_candidates_welcome(p_clinic_id) c;

  elsif p_kind = 'reengagement' then
    v_cap := 5; v_tick := 15;
    v_win_start := coalesce(v_ac.followup_window_start, 6);
    v_win_end   := coalesce(v_ac.followup_window_end, 22);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'passo ' || c.step_no || case when c.is_closing then ' (encerra o atendimento)' else '' end
      from fn_followup_candidates_reengagement(p_clinic_id) c;

  elsif p_kind = 'confirmation' then
    v_cap := 5; v_tick := 1;
    v_win_start := coalesce(v_ac.confirm_window_start, 6);
    v_win_end   := coalesce(v_ac.confirm_window_end, 22);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'consulta ' || substr(c.data_consulta,1,5) || ' às ' || c.hora_consulta
      from fn_followup_candidates_confirmation(p_clinic_id) c;

  elsif p_kind = 'appt_reminder' then
    v_cap := 5; v_tick := 1;
    v_win_start := coalesce(v_ac.appt_reminder_window_start, 8);
    v_win_end   := coalesce(v_ac.appt_reminder_window_end, 20);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'consulta ' || substr(c.data_consulta,1,5) || ' às ' || c.hora_consulta
      from fn_followup_candidates_appt_reminder(p_clinic_id) c
     where c.expires_at >= v_now;

  elsif p_kind in ('pos_ganho','pos_perdido') then
    v_cap := 5; v_tick := 15;
    v_win_start := coalesce(v_ac.pos_followup_window_start, 8);
    v_win_end   := coalesce(v_ac.pos_followup_window_end, 20);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'ticket ' || c.outcome || ' em ' || to_char(c.encerrado_em, 'DD/MM')
      from fn_followup_candidates_pos(p_clinic_id) c
     where c.outcome = case when p_kind = 'pos_ganho' then 'ganho' else 'perdido' end
       and c.expires_at >= v_now;

  elsif p_kind in ('finish_ganho','finish_perdido','finish_service') then
    v_is_trigger := true;
    select count(*) into v_hist
      from tickets t join leads l on l.id = t.lead_id
     where t.clinic_id = p_clinic_id
       and coalesce(l.is_not_lead, false) = false
       and coalesce(l.followup_enabled, true) = true
       and l.phone is not null and l.phone <> ''
       and (
            (p_kind = 'finish_ganho'   and t.outcome = 'ganho'   and t.outcome_at >= now() - interval '7 days')
         or (p_kind = 'finish_perdido' and t.outcome = 'perdido' and t.outcome_at >= now() - interval '7 days')
         -- 'service' = fechou SEM mudar o outcome. finalize_ticket grava os dois no mesmo statement
         -- (outcome_at = closed_at) e dispara ganho/perdido, não service.
         or (p_kind = 'finish_service' and t.status = 'closed'
             and t.closed_at >= now() - interval '7 days'
             and (t.outcome is null or t.outcome_at is distinct from t.closed_at))
       );
  else
    raise exception 'p_kind inválido: %', p_kind;
  end if;

  if not v_is_trigger then
    v_in_window := v_hour >= v_win_start and v_hour < v_win_end;

    select
      count(*) filter (where quando <= v_now and v_in_window),
      count(*) filter (where (quando <= v_now and not v_in_window)
                          or (quando > v_now and quando <= v_now + interval '24 hours')),
      count(*) filter (where quando > v_now + interval '24 hours' and quando <= v_now + interval '7 days'),
      count(*) filter (where quando <= v_now + interval '7 days')
      into v_agora, v_horas, v_dias, v_total_7d
      from _fu_prev;

    select coalesce(jsonb_agg(jsonb_build_object(
             'lead_id',  lead_id,
             'nome',     coalesce(nullif(btrim(nome), ''), 'Sem nome'),
             'telefone', telefone,
             'detalhe',  detalhe,
             'quando',   to_char(quando, 'DD/MM HH24:MI'),
             'balde',    case when quando <= v_now and v_in_window then 'agora'
                              when quando <= v_now + interval '24 hours' then 'horas'
                              else 'dias' end
           ) order by quando), '[]'::jsonb)
      into v_sample
      from (select * from _fu_prev where quando <= v_now + interval '7 days'
             order by quando limit 50) s;

    if v_cap is not null and v_cap > 0 and v_agora > 0 then
      v_drain := ceil(v_agora::numeric / v_cap)::int * v_tick;
    end if;
  end if;

  return jsonb_build_object(
    'kind', p_kind, 'is_trigger', v_is_trigger,
    'whatsapp_ok', v_wa_ok, 'whatsapp_status', v_wa.status, 'blocked_until', v_wa.send_blocked_until,
    'in_window', v_in_window, 'window_start', v_win_start, 'window_end', v_win_end,
    'cap_por_rodada', v_cap, 'rodada_minutos', v_tick,
    'agora', v_agora, 'proximas_horas', v_horas, 'proximos_dias', v_dias, 'total_7d', v_total_7d,
    'primeiro_disparo', least(v_agora, coalesce(v_cap, v_agora)),
    'escoamento_min', v_drain, 'historico_7d', v_hist, 'amostra', v_sample
  );
exception when others then
  if sqlstate <> 'P0001' then
    perform log_system_error('followup-preview','preview_failed',
      'Falha ao calcular o preview de ativação de follow-up','error', p_clinic_id,
      jsonb_build_object('kind', p_kind, 'sqlstate', sqlstate, 'detail', sqlerrm), false);
  end if;
  raise;
end;
$function$;

-- ============================================================ permissões
-- revoke de PUBLIC (anon/authenticated herdam EXECUTE via PUBLIC). CREATE OR REPLACE preservou os
-- grants do preview; re-afirmo por segurança.
revoke all on function public.fn_followup_candidates_appt_reminder(uuid) from public;
revoke all on function public.preview_followup_activation(uuid, text)     from public;
grant execute on function public.preview_followup_activation(uuid, text)   to authenticated;

-- ============================================================ cron (SP: janela checada dentro do motor)
-- 1 minuto obrigatório: com lead_time de 30min, um tick de 15min erraria metade do alvo.
select cron.schedule('appt_reminder_job', '* * * * *', 'select public.process_appointment_reminders()');
