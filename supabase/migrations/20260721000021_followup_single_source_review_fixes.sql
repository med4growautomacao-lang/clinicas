-- Correções do review da fonte única (aplicadas por MCP em 3 partes:
-- followup_single_source_review_fixes, preview_window_from_config_single_call,
-- followup_candidates_revoke_from_public).
--
-- 1) "WhatsApp apto a enviar" tinha QUATRO definições dentro da própria fonte única (welcome sem
--    token, reengaj com token, confirmação no WHERE, pós sem token). Vira uma só: fn_clinic_can_send.
--    Isso conserta o BLOQUEIO DE FILA do pós: sem o token no wa_ok, linha sem token era escolhida,
--    caía no `continue` sem marcar nada e ocupava o slot do cap toda rodada (583 candidatos sem token).
-- 2) Janela do pós sai do hardcode e vai para ai_config, como as outras três.
-- 3) Preview: janela volta a sair de ai_config. Derivá-la com max() sobre as linhas fazia virar o
--    default 6-22 com a fila VAZIA (a Vaz é 8h-17h). Isso também elimina a SEGUNDA chamada de cada
--    função de candidatos, que dobrava o custo do modal.
-- 4) Preview do pós volta a mostrar a data do encerramento (coluna encerrado_em).
-- 5) Filtro de telefone no pós (linha não enviável não ocupa slot), igual à confirmação.
-- 6) REVOKE de PUBLIC. Atenção: `revoke ... from anon, authenticated` NÃO funciona, porque toda
--    função nasce com EXECUTE para PUBLIC e os papéis herdam por aí. Verificado com
--    `set local role authenticated`: antes do fix a função de candidatos ainda executava.
--
-- Impacto de envio MEDIDO antes de aplicar: welcome 0->0, pós 0->0, reengajamento 5->5.

create or replace function public.fn_clinic_can_send(p_clinic_id uuid)
returns boolean language sql stable set search_path to 'public' as $$
  select exists (
    select 1 from whatsapp_instances wi
     where wi.clinic_id = p_clinic_id
       and wi.status = 'connected'
       and wi.api_token is not null and btrim(wi.api_token) <> ''
       and (wi.send_blocked_until is null or wi.send_blocked_until <= now())
  )
$$;

comment on function public.fn_clinic_can_send(uuid) is
  'Definição ÚNICA de "a clínica pode enviar agora": conectada, com token e sem bloqueio de envio (463). Usada por todas as fn_followup_candidates_*.';

alter table public.ai_config
  add column if not exists pos_followup_window_start int not null default 8,
  add column if not exists pos_followup_window_end   int not null default 20;

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
    fn_clinic_can_send(l.clinic_id),
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
    fn_clinic_can_send(l.clinic_id),
    coalesce(ac.followup_window_start, 6), coalesce(ac.followup_window_end, 22)
  from leads l
  join ai_config ac on ac.clinic_id = l.clinic_id
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
    fn_clinic_can_send(a.clinic_id),
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
    -- linha não enviável não ocupa slot do cap (o token virou responsabilidade do wa_ok)
    and normalize_br_phone(p.phone) is not null
$$;

-- pos ganha coluna nova (encerrado_em): precisa de drop+create na MESMA transação.
drop function if exists public.fn_followup_candidates_pos(uuid);
create function public.fn_followup_candidates_pos(p_clinic_id uuid default null)
returns table (
  clinic_id uuid, ticket_id uuid, lead_id uuid, nome text, telefone text,
  outcome text, message text, api_token text, encerrado_em timestamp,
  eligible_at timestamp, expires_at timestamp, toggle_on boolean, wa_ok boolean,
  window_start int, window_end int
)
language sql stable set search_path to 'public' as $$
  select
    t.clinic_id, t.id, t.lead_id, l.name, normalize_br_phone(l.phone),
    t.outcome,
    case when t.outcome = 'ganho' then ai.pos_followup_ganho_message else ai.pos_followup_perdido_message end,
    wa.api_token,
    (t.outcome_at at time zone 'America/Sao_Paulo')::timestamp,
    ((t.outcome_at at time zone 'America/Sao_Paulo')
      + ((case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_days,1)
               else coalesce(ai.pos_followup_perdido_days,1) end) || ' days')::interval)::timestamp,
    ((t.outcome_at at time zone 'America/Sao_Paulo')
      + (((case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_days,1)
                else coalesce(ai.pos_followup_perdido_days,1) end)
          + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)::timestamp,
    case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_enabled,false)
         else coalesce(ai.pos_followup_perdido_enabled,false) end,
    fn_clinic_can_send(t.clinic_id),
    coalesce(ai.pos_followup_window_start, 8), coalesce(ai.pos_followup_window_end, 20)
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
    -- linha não enviável não ocupa slot do cap (mesma trava da confirmação)
    and normalize_br_phone(l.phone) is not null
    and not exists (select 1 from tickets t2
                     where t2.lead_id = t.lead_id and t2.status = 'open' and t2.id <> t.id)
    and not exists (select 1 from chat_messages cm
                     where cm.lead_id = t.lead_id and cm.direction = 'inbound'
                       and cm.created_at > (t.outcome_at at time zone 'America/Sao_Paulo'))
$$;

-- ---------------------------------------------------------------- PREVIEW
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

  v_wa_ok := fn_clinic_can_send(p_clinic_id);   -- mesma definição que os motores usam

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

-- ⚠️ revoke de PUBLIC, não dos papéis: anon/authenticated herdam EXECUTE via PUBLIC.
revoke all on function public.fn_clinic_can_send(uuid)                  from public;
revoke all on function public.fn_followup_candidates_welcome(uuid)      from public;
revoke all on function public.fn_followup_candidates_reengagement(uuid) from public;
revoke all on function public.fn_followup_candidates_confirmation(uuid) from public;
revoke all on function public.fn_followup_candidates_pos(uuid)          from public;
revoke all on function public.preview_followup_activation(uuid, text)   from public;
grant execute on function public.preview_followup_activation(uuid, text) to authenticated;
