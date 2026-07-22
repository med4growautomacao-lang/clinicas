-- FONTE ÚNICA do predicado de cada follow-up (aplicada por MCP em 3 partes:
-- followup_candidates_single_source, followups_consume_single_source, preview_consumes_single_source).
--
-- PROBLEMA: o preview de ativação carregava sua PRÓPRIA cópia dos gates de cada motor. Enquanto for
-- cópia, qualquer edição num selector faz a janela MENTIR em silêncio (ela não quebra, só passa a
-- contar errado) e é justamente a veracidade dela que dá valor à trava. Os selectors foram reescritos
-- 3 vezes num único dia, então a deriva não é hipotética.
--
-- DIVISÃO DE RESPONSABILIDADE:
--   fn_followup_candidates_* = gates duráveis do negócio + eligible_at (quando o lead passa a poder
--                              receber) + toggle_on / wa_ok / janela, expostos como COLUNAS.
--   motor   = corte de tempo (eligible_at <= agora), janela de horário, cap por rodada e envio.
--   preview = ignora o toggle (é o que está sendo ligado) e distribui eligible_at nos baldes.
--
-- EQUIVALÊNCIA VERIFICADA ANTES DO CUTOVER, comparando conjunto antigo x novo por clínica:
--   welcome 78=78 · reengajamento 973=973 · confirmação 16=16 · pós 725=725
--   diferença simétrica ZERO nos quatro. Nenhuma regra de negócio muda aqui.

-- ============================================================ 1) FONTE ÚNICA (só leitura)

create or replace function public.fn_followup_candidates_welcome(p_clinic_id uuid default null)
returns table (
  clinic_id uuid, lead_id uuid, nome text, telefone text,
  clinic_phone text, message_text text,
  eligible_at timestamp, toggle_on boolean, wa_ok boolean,
  window_start int, window_end int
)
language sql stable set search_path to 'public' as $$
  select
    l.clinic_id, l.id, l.name, l.phone,
    ac.phone, ac.welcome_message_text,
    (l.created_at + (coalesce(ac.welcome_message_delay, 5) || ' minutes')::interval)::timestamp,
    coalesce(ac.welcome_message_enabled, false),
    exists (select 1 from whatsapp_instances wi
             where wi.clinic_id = l.clinic_id and wi.status = 'connected'
               and (wi.send_blocked_until is null or wi.send_blocked_until <= now())),
    coalesce(ac.welcome_window_start, 6), coalesce(ac.welcome_window_end, 22)
  from leads l
  join ai_config ac on ac.clinic_id = l.clinic_id
  where (p_clinic_id is null or l.clinic_id = p_clinic_id)
    and l.capture_channel = 'forms'
    and l.welcome_sent = false
    and coalesce(l.is_not_lead, false) = false
    and l.phone is not null and l.phone <> ''
    and not exists (select 1 from chat_messages cm where cm.lead_id = l.id)
    and l.created_at >= ((now() at time zone 'America/Sao_Paulo') - interval '3 days')
$$;

create or replace function public.fn_followup_candidates_reengagement(p_clinic_id uuid default null)
returns table (
  clinic_id uuid, lead_id uuid, nome text, telefone text,
  clinic_phone text, message_text text, step_no int, is_closing boolean, expected_count int,
  eligible_at timestamp, toggle_on boolean, wa_ok boolean,
  window_start int, window_end int
)
language sql stable set search_path to 'public' as $$
  select
    l.clinic_id, l.id, l.name, l.phone,
    w.phone_number, s.message_text, s.step_no, s.is_closing, l.followup_count,
    (greatest(lm.last_at, coalesce(l.followup_sent_at, lm.last_at))
       + (s.delay_minutes || ' minutes')::interval)::timestamp,
    coalesce(ac.followup_enabled, false),
    (w.status = 'connected'
       and w.api_token is not null
       and (w.send_blocked_until is null or w.send_blocked_until <= now())),
    coalesce(ac.followup_window_start, 6), coalesce(ac.followup_window_end, 22)
  from leads l
  join ai_config ac on ac.clinic_id = l.clinic_id
  join followup_steps s
    on s.clinic_id = l.clinic_id and s.step_no = l.followup_count + 1 and s.enabled = true
  join lateral (
    select wi.phone_number, wi.api_token, wi.status, wi.send_blocked_until
      from whatsapp_instances wi where wi.clinic_id = l.clinic_id
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
$$;

create or replace function public.fn_followup_candidates_confirmation(p_clinic_id uuid default null)
returns table (
  clinic_id uuid, appointment_id uuid, lead_id uuid, nome text, telefone text,
  data_consulta text, hora_consulta text, confirm_message text, api_token text,
  eligible_at timestamp, toggle_on boolean, wa_ok boolean,
  window_start int, window_end int
)
language sql stable set search_path to 'public' as $$
  select
    a.clinic_id, a.id, t.lead_id, p.name, normalize_br_phone(p.phone),
    to_char(a.date,'DD/MM/YYYY'), to_char(a.time,'HH24:MI'), ai.confirm_message, wa.api_token,
    ((a.date + a.time) - (coalesce(ai.confirm_lead_time, 1440) || ' minutes')::interval)::timestamp,
    coalesce(ai.confirm_enabled, false),
    (wa.status = 'connected' and (wa.send_blocked_until is null or wa.send_blocked_until <= now())),
    coalesce(ai.confirm_window_start, 6), coalesce(ai.confirm_window_end, 22)
  from appointments a
  join patients p on p.id = a.patient_id
  join doctors d on d.id = a.doctor_id
  join ai_config ai on ai.clinic_id = a.clinic_id
  join whatsapp_instances wa on wa.clinic_id = a.clinic_id
  left join tickets t on t.id = a.ticket_id
  left join leads   l on l.id = t.lead_id
  where (p_clinic_id is null or a.clinic_id = p_clinic_id)
    and a.reminder_sent_at is null
    and a.status in ('pendente','confirmado')
    and nullif(btrim(ai.confirm_message), '') is not null
    and coalesce(l.followup_enabled, true) = true
    and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
    -- linha não enviável não pode ocupar slot do cap (vide 20260721000018)
    and normalize_br_phone(p.phone) is not null
    and wa.api_token is not null and btrim(wa.api_token) <> ''
$$;

create or replace function public.fn_followup_candidates_pos(p_clinic_id uuid default null)
returns table (
  clinic_id uuid, ticket_id uuid, lead_id uuid, nome text, telefone text,
  outcome text, message text, api_token text,
  eligible_at timestamp, expires_at timestamp, toggle_on boolean, wa_ok boolean,
  window_start int, window_end int
)
language sql stable set search_path to 'public' as $$
  select
    t.clinic_id, t.id, t.lead_id, l.name, normalize_br_phone(l.phone),
    t.outcome,
    case when t.outcome = 'ganho' then ai.pos_followup_ganho_message else ai.pos_followup_perdido_message end,
    wa.api_token,
    ((t.outcome_at at time zone 'America/Sao_Paulo')
      + ((case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_days,1)
               else coalesce(ai.pos_followup_perdido_days,1) end) || ' days')::interval)::timestamp,
    ((t.outcome_at at time zone 'America/Sao_Paulo')
      + (((case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_days,1)
                else coalesce(ai.pos_followup_perdido_days,1) end)
          + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)::timestamp,
    case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_enabled,false)
         else coalesce(ai.pos_followup_perdido_enabled,false) end,
    (wa.status = 'connected' and (wa.send_blocked_until is null or wa.send_blocked_until <= now())),
    8, 20
  from tickets t
  join leads l on l.id = t.lead_id
  join ai_config ai on ai.clinic_id = t.clinic_id
  join whatsapp_instances wa on wa.clinic_id = t.clinic_id
  where (p_clinic_id is null or t.clinic_id = p_clinic_id)
    and t.outcome in ('ganho','perdido')
    and t.outcome_at is not null
    and t.pos_followup_sent_at is null
    and t.pos_followup_expired_at is null
    and coalesce(l.followup_enabled, true) = true
    and coalesce(l.is_not_lead, false) = false
    and not exists (select 1 from tickets t2
                     where t2.lead_id = t.lead_id and t2.status = 'open' and t2.id <> t.id)
    and not exists (select 1 from chat_messages cm
                     where cm.lead_id = t.lead_id and cm.direction = 'inbound'
                       and cm.created_at > (t.outcome_at at time zone 'America/Sao_Paulo'))
$$;

-- ============================================================ 2) MOTORES CONSOMEM A FONTE

create or replace function public.process_forms_followup()
 returns void language plpgsql as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/forms-welcome-followup';
  v_payload jsonb;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 3;
begin
  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_welcome() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at < v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    v_payload := jsonb_build_object(
      'lead_id', r.lead_id, 'name', r.nome, 'phone', r.telefone,
      'clinic_id', r.clinic_id, 'clinic_phone', r.clinic_phone,
      'message_text', r.message_text, 'type', 'welcome');
    perform public.system_http_post(
      url := v_url, headers := jsonb_build_object('Content-Type','application/json'), body := v_payload);
  end loop;
end; $function$;

create or replace function public.process_reengagement_followup()
 returns void language plpgsql as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/reengagement-followup';
  v_payload jsonb;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_reengagement() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at < v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    v_payload := jsonb_build_object(
      'lead_id', r.lead_id, 'clinic_id', r.clinic_id, 'name', r.nome, 'phone', r.telefone,
      'clinic_phone', r.clinic_phone, 'message_text', r.message_text,
      'step_no', r.step_no, 'is_closing', r.is_closing, 'expected_count', r.expected_count);
    perform public.system_http_post(
      url := v_url, headers := jsonb_build_object('Content-Type','application/json'), body := v_payload);
  end loop;
end; $function$;

create or replace function public.process_confirmation_reminders()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; v_msg text; v_count integer := 0;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_confirmation() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at <= v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    begin
      v_msg := replace(replace(replace(coalesce(r.confirm_message,''),
        '{paciente}', coalesce(r.nome,'')), '{data}', r.data_consulta), '{hora}', r.hora_consulta);

      perform system_http_post('https://med4growautomacao.uazapi.com/send/menu',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.telefone, 'type', 'button', 'text', v_msg,
          'choices', jsonb_build_array('Confirmar consulta|confirmado','Remarcar consulta|remarcar','Cancelar consulta|cancelado'),
          'footerText', 'Por favor, clique em uma das opções abaixo.'),
        5000);

      if r.lead_id is not null then
        insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
        values (r.clinic_id, r.lead_id, r.telefone, 'outbound', 'system',
                jsonb_build_object('type','system','content', v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));
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

create or replace function public.process_pos_followup()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; v_msg text; v_count integer := 0; v_expired integer := 0;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  -- Vencimento continua sendo escrita do motor (a fonte única é só leitura).
  with expired as (
    update public.tickets t set pos_followup_expired_at = now()
      from public.ai_config ai
     where ai.clinic_id = t.clinic_id
       and t.outcome in ('ganho','perdido') and t.outcome_at is not null
       and t.pos_followup_sent_at is null and t.pos_followup_expired_at is null
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
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_pos() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at <= v_now and c.expires_at >= v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    begin
      v_msg := r.message;
      if v_msg is null or btrim(v_msg) = '' then
        update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
        continue;
      end if;
      if r.telefone is null or r.api_token is null or btrim(r.api_token) = '' then continue; end if;
      v_msg := replace(replace(v_msg, '{paciente}', coalesce(r.nome,'')), '{nome}', coalesce(r.nome,''));

      perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.telefone, 'text', v_msg, 'delay', 0), 5000);

      insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
      values (r.clinic_id, r.lead_id, r.telefone, 'outbound', 'system',
              jsonb_build_object('type','system','content', v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

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

-- ============================================================ 3) PREVIEW CONSOME A MESMA FONTE

create or replace function public.preview_followup_activation(
  p_clinic_id uuid,
  p_kind      text
) returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour  int       := extract(hour from (now() at time zone 'America/Sao_Paulo'));
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

  select wi.status, wi.api_token, wi.send_blocked_until into v_wa
    from whatsapp_instances wi where wi.clinic_id = p_clinic_id
   order by (wi.status = 'connected') desc nulls last limit 1;

  v_wa_ok := coalesce(v_wa.status = 'connected', false)
             and v_wa.api_token is not null and btrim(v_wa.api_token) <> ''
             and (v_wa.send_blocked_until is null or v_wa.send_blocked_until <= now());

  create temp table if not exists _fu_prev (
    lead_id uuid, nome text, telefone text, quando timestamp, detalhe text
  ) on commit drop;
  -- TRUNCATE e não DELETE: na sessão do PostgREST o safe-updates recusa DELETE sem WHERE.
  truncate table _fu_prev;

  if p_kind = 'welcome' then
    v_cap := 3; v_tick := 1;
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at, 'lead de formulário'
      from fn_followup_candidates_welcome(p_clinic_id) c;
    select max(window_start), max(window_end) into v_win_start, v_win_end
      from fn_followup_candidates_welcome(p_clinic_id);

  elsif p_kind = 'reengagement' then
    v_cap := 5; v_tick := 15;
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'passo ' || c.step_no || case when c.is_closing then ' (encerra o atendimento)' else '' end
      from fn_followup_candidates_reengagement(p_clinic_id) c;
    select max(window_start), max(window_end) into v_win_start, v_win_end
      from fn_followup_candidates_reengagement(p_clinic_id);

  elsif p_kind = 'confirmation' then
    v_cap := 5; v_tick := 1;
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'consulta ' || substr(c.data_consulta,1,5) || ' às ' || c.hora_consulta
      from fn_followup_candidates_confirmation(p_clinic_id) c;
    select max(window_start), max(window_end) into v_win_start, v_win_end
      from fn_followup_candidates_confirmation(p_clinic_id);

  elsif p_kind in ('pos_ganho','pos_perdido') then
    v_cap := 5; v_tick := 15;
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'ticket ' || c.outcome || ' encerrado'
      from fn_followup_candidates_pos(p_clinic_id) c
     where c.outcome = case when p_kind = 'pos_ganho' then 'ganho' else 'perdido' end
       and c.expires_at >= v_now;
    v_win_start := 8; v_win_end := 20;

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
         -- (outcome_at = closed_at) e dispara ganho/perdido, não service. Sem este recorte o
         -- histórico contava 92 onde o real eram 11.
         or (p_kind = 'finish_service' and t.status = 'closed'
             and t.closed_at >= now() - interval '7 days'
             and (t.outcome is null or t.outcome_at is distinct from t.closed_at))
       );
  else
    raise exception 'p_kind inválido: %', p_kind;
  end if;

  if not v_is_trigger then
    v_win_start := coalesce(v_win_start, 6);
    v_win_end   := coalesce(v_win_end, 22);
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
  -- CLAUDE.md: RPC que importa registra na Central. P0001 = raise deliberado daqui (permissão /
  -- kind inválido). NÃO engole: re-levanta para o modal seguir mostrando o motivo ao usuário.
  if sqlstate <> 'P0001' then
    perform log_system_error('followup-preview','preview_failed',
      'Falha ao calcular o preview de ativação de follow-up','error', p_clinic_id,
      jsonb_build_object('kind', p_kind, 'sqlstate', sqlstate, 'detail', sqlerrm), false);
  end if;
  raise;
end;
$function$;

revoke all on function public.preview_followup_activation(uuid, text) from anon;
grant execute on function public.preview_followup_activation(uuid, text) to authenticated;
