-- Preview de impacto ao LIGAR um follow-up: quem é afetado agora, nas próximas horas e nos próximos dias.
--
-- POR QUE NO BANCO: se o preview reimplementasse os gates no frontend, ele mentiria na primeira
-- divergência (e ainda bateria no clamp de 1000 linhas do PostgREST). Aqui roda EXATAMENTE o mesmo
-- predicado do motor, com uma única diferença: ignora o toggle que está prestes a ser ligado.
-- Não envia nada, não escreve nada.
--
-- Baldes (relógio de São Paulo):
--   agora          -> já passa em todos os gates neste minuto (fila real)
--   proximas_horas -> entra nas próximas 24h (preso por delay, ou fora da janela de horário agora)
--   proximos_dias  -> entra entre 24h e 7 dias
-- Mais: cap por rodada e estimativa de escoamento (fila ÷ cap × cadência), que é o que evita a
-- rajada de cold outreach que já fez o WhatsApp da Vaz ser restringido (erro 463).
--
-- ENCERRAMENTO é diferente: é trigger na transição do ticket, não fila. Ligar não afeta ninguém
-- retroativamente, então devolve is_trigger=true + o histórico de 7 dias como estimativa de volume.
--
-- p_kind: welcome | reengagement | confirmation | pos_ganho | pos_perdido
--         finish_ganho | finish_perdido | finish_service

create or replace function public.preview_followup_activation(
  p_clinic_id uuid,
  p_kind      text
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour  int       := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_ac    ai_config%rowtype;
  v_wa    record;
  v_in_window boolean := true;
  v_wa_ok  boolean := false;
  v_cap    int := null;
  v_tick   int := null;
  v_is_trigger boolean := false;
  v_agora int := 0; v_horas int := 0; v_dias int := 0;
  v_total_7d int := 0;
  v_sample jsonb := '[]'::jsonb;
  v_hist   int := null;
  v_days   int; v_grace int;
  v_win_start int; v_win_end int;
  v_drain  int := 0;
begin
  -- Permissão: só quem enxerga a clínica.
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

  select wi.status, wi.api_token, wi.send_blocked_until into v_wa
    from whatsapp_instances wi
   where wi.clinic_id = p_clinic_id
   order by (wi.status = 'connected') desc nulls last
   limit 1;

  v_wa_ok := coalesce(v_wa.status = 'connected', false)
             and v_wa.api_token is not null and btrim(v_wa.api_token) <> ''
             and (v_wa.send_blocked_until is null or v_wa.send_blocked_until <= now());

  create temp table if not exists _fu_prev (
    nome text, telefone text, quando timestamp, detalhe text
  ) on commit drop;
  delete from _fu_prev;

  -- ---------------------------------------------------------------- BOAS-VINDAS
  if p_kind = 'welcome' then
    v_cap := 3; v_tick := 1;
    v_win_start := coalesce(v_ac.welcome_window_start, 6);
    v_win_end   := coalesce(v_ac.welcome_window_end, 22);
    v_in_window := v_hour >= v_win_start and v_hour < v_win_end;

    insert into _fu_prev
    select l.name, l.phone,
           (l.created_at + (coalesce(v_ac.welcome_message_delay, 5) || ' minutes')::interval)::timestamp,
           'lead de formulário'
      from leads l
     where l.clinic_id = p_clinic_id
       and l.capture_channel = 'forms'
       and l.welcome_sent = false
       and coalesce(l.is_not_lead, false) = false
       and l.phone is not null and l.phone <> ''
       and not exists (select 1 from chat_messages cm where cm.lead_id = l.id)
       and l.created_at >= (v_now - interval '3 days');

  -- ---------------------------------------------------------------- REENGAJAMENTO
  elsif p_kind = 'reengagement' then
    v_cap := 5; v_tick := 15;
    v_win_start := coalesce(v_ac.followup_window_start, 6);
    v_win_end   := coalesce(v_ac.followup_window_end, 22);
    v_in_window := v_hour >= v_win_start and v_hour < v_win_end;

    insert into _fu_prev
    select l.name, l.phone,
           greatest(lm.last_at, coalesce(l.followup_sent_at, lm.last_at))
             + (s.delay_minutes || ' minutes')::interval,
           'passo ' || s.step_no || case when s.is_closing then ' (encerra o atendimento)' else '' end
      from leads l
      join followup_steps s
        on s.clinic_id = l.clinic_id and s.step_no = l.followup_count + 1 and s.enabled = true
      join lateral (
             select cm.direction as last_dir, cm.created_at as last_at
               from chat_messages cm where cm.lead_id = l.id
              order by cm.seq desc limit 1
           ) lm on true
     where l.clinic_id = p_clinic_id
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
       and lm.last_at >= (v_now - (coalesce(v_ac.followup_max_idle_days, 7) || ' days')::interval);

  -- ---------------------------------------------------------------- CONFIRMAÇÃO
  elsif p_kind = 'confirmation' then
    v_cap := 5; v_tick := 1;
    v_win_start := coalesce(v_ac.confirm_window_start, 6);
    v_win_end   := coalesce(v_ac.confirm_window_end, 22);
    v_in_window := v_hour >= v_win_start and v_hour < v_win_end;

    insert into _fu_prev
    select p.name, p.phone,
           ((a.date + a.time) - (coalesce(v_ac.confirm_lead_time, 1440) || ' minutes')::interval)::timestamp,
           'consulta ' || to_char(a.date, 'DD/MM') || ' às ' || to_char(a.time, 'HH24:MI')
      from appointments a
      join patients p on p.id = a.patient_id
      left join tickets t on t.id = a.ticket_id
      left join leads   l on l.id = t.lead_id
     where a.clinic_id = p_clinic_id
       and a.reminder_sent_at is null
       and a.status in ('pendente','confirmado')
       and coalesce(l.followup_enabled, true) = true
       and (a.date + a.time) > v_now
       and nullif(btrim(coalesce(v_ac.confirm_message, '')), '') is not null;

  -- ---------------------------------------------------------------- PÓS-ATENDIMENTO
  elsif p_kind in ('pos_ganho','pos_perdido') then
    v_cap := 5; v_tick := 15;
    v_win_start := 8; v_win_end := 20;
    v_in_window := v_hour >= 8 and v_hour < 20;
    v_days  := case when p_kind = 'pos_ganho'
                    then coalesce(v_ac.pos_followup_ganho_days, 1)
                    else coalesce(v_ac.pos_followup_perdido_days, 1) end;
    v_grace := coalesce(v_ac.pos_followup_grace_days, 2);

    insert into _fu_prev
    select l.name, l.phone,
           ((t.outcome_at at time zone 'America/Sao_Paulo') + (v_days || ' days')::interval),
           'ticket ' || t.outcome || ' em ' || to_char(t.outcome_at at time zone 'America/Sao_Paulo', 'DD/MM')
      from tickets t
      join leads l on l.id = t.lead_id
     where t.clinic_id = p_clinic_id
       and t.outcome = case when p_kind = 'pos_ganho' then 'ganho' else 'perdido' end
       and t.outcome_at is not null
       and t.pos_followup_sent_at is null
       and t.pos_followup_expired_at is null
       and coalesce(l.followup_enabled, true) = true
       and coalesce(l.is_not_lead, false) = false
       and l.phone is not null and l.phone <> ''
       and not exists (select 1 from tickets t2
                        where t2.lead_id = t.lead_id and t2.status = 'open' and t2.id <> t.id)
       and not exists (select 1 from chat_messages cm
                        where cm.lead_id = t.lead_id and cm.direction = 'inbound'
                          and cm.created_at > (t.outcome_at at time zone 'America/Sao_Paulo'))
       -- ainda dentro da carência (fora dela o motor marca como vencido e nunca envia)
       and (t.outcome_at at time zone 'America/Sao_Paulo') >= (v_now - ((v_days + v_grace) || ' days')::interval);

  -- ---------------------------------------------------------------- ENCERRAMENTO (trigger)
  elsif p_kind in ('finish_ganho','finish_perdido','finish_service') then
    v_is_trigger := true;
    select count(*) into v_hist
      from tickets t
      join leads l on l.id = t.lead_id
     where t.clinic_id = p_clinic_id
       and coalesce(l.is_not_lead, false) = false
       and coalesce(l.followup_enabled, true) = true
       and l.phone is not null and l.phone <> ''
       and (
            (p_kind = 'finish_ganho'   and t.outcome = 'ganho'   and t.outcome_at >= now() - interval '7 days')
         or (p_kind = 'finish_perdido' and t.outcome = 'perdido' and t.outcome_at >= now() - interval '7 days')
         or (p_kind = 'finish_service' and t.status  = 'closed'  and t.closed_at  >= now() - interval '7 days')
       );

  else
    raise exception 'p_kind inválido: %', p_kind;
  end if;

  -- ---------------------------------------------------------------- agregação comum
  if not v_is_trigger then
    select
      count(*) filter (where quando <= v_now and v_in_window),
      count(*) filter (where (quando <= v_now and not v_in_window)
                          or (quando > v_now and quando <= v_now + interval '24 hours')),
      count(*) filter (where quando > v_now + interval '24 hours'
                         and quando <= v_now + interval '7 days'),
      count(*) filter (where quando <= v_now + interval '7 days')
      into v_agora, v_horas, v_dias, v_total_7d
      from _fu_prev;

    select coalesce(jsonb_agg(jsonb_build_object(
             'nome',     coalesce(nullif(btrim(nome), ''), 'Sem nome'),
             'telefone', telefone,
             'detalhe',  detalhe,
             'quando',   to_char(quando, 'DD/MM HH24:MI'),
             'balde',    case when quando <= v_now and v_in_window then 'agora'
                              when quando <= v_now + interval '24 hours' then 'horas'
                              else 'dias' end
           ) order by quando), '[]'::jsonb)
      into v_sample
      from (select * from _fu_prev
             where quando <= v_now + interval '7 days'
             order by quando limit 50) s;

    if v_cap is not null and v_cap > 0 and v_agora > 0 then
      v_drain := ceil(v_agora::numeric / v_cap)::int * v_tick;
    end if;
  end if;

  return jsonb_build_object(
    'kind',            p_kind,
    'is_trigger',      v_is_trigger,
    'whatsapp_ok',     v_wa_ok,
    'whatsapp_status', v_wa.status,
    'blocked_until',   v_wa.send_blocked_until,
    'in_window',       v_in_window,
    'window_start',    v_win_start,
    'window_end',      v_win_end,
    'cap_por_rodada',  v_cap,
    'rodada_minutos',  v_tick,
    'agora',           v_agora,
    'proximas_horas',  v_horas,
    'proximos_dias',   v_dias,
    'total_7d',        v_total_7d,
    'primeiro_disparo',least(v_agora, coalesce(v_cap, v_agora)),
    'escoamento_min',  v_drain,
    'historico_7d',    v_hist,
    'amostra',         v_sample
  );
end;
$function$;

revoke all on function public.preview_followup_activation(uuid, text) from anon;
grant execute on function public.preview_followup_activation(uuid, text) to authenticated;
