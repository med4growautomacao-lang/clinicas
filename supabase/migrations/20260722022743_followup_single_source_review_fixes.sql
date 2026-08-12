-- 20260722022743_followup_single_source_review_fixes
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Correções do review da fonte única.
--
-- 1) "WhatsApp apto a enviar" tinha QUATRO definições dentro da própria fonte única (welcome sem
--    token, reengaj com token, confirmação no WHERE, pós sem token). Vira uma só: fn_clinic_can_send.
--    Isso conserta o bloqueio de fila do pós: sem o token no wa_ok, linha sem token era escolhida,
--    caía no `continue` sem marcar nada e ocupava o slot do cap toda rodada (583 candidatos sem token).
-- 2) Janela do pós sai do hardcode e vai para ai_config, como as outras três.
-- 3) Preview do pós volta a mostrar a data do encerramento (nova coluna encerrado_em).
-- 4) Filtro de telefone no pós (linha não enviável não ocupa slot), igual à confirmação.
-- 5) REVOKE nas funções novas: nasceram com EXECUTE para PUBLIC (anon/authenticated) e uma delas
--    devolve api_token. Só o preview (security definer) e os motores (postgres) precisam chamá-las.
--
-- Impacto de envio MEDIDO antes de aplicar: welcome 0->0, pós 0->0, reengajamento 5->5.

-- ---------------------------------------------------------------- 1) conceito único
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

-- ---------------------------------------------------------------- 2) janela do pós configurável
alter table public.ai_config
  add column if not exists pos_followup_window_start int not null default 8,
  add column if not exists pos_followup_window_end   int not null default 20;

-- ---------------------------------------------------------------- 3) candidatos
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

-- pos ganha coluna nova (encerrado_em), então precisa de drop+create na MESMA transação.
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

-- ---------------------------------------------------------------- 4) fechar a exposição
revoke all on function public.fn_clinic_can_send(uuid)                      from anon, authenticated;
revoke all on function public.fn_followup_candidates_welcome(uuid)          from anon, authenticated;
revoke all on function public.fn_followup_candidates_reengagement(uuid)     from anon, authenticated;
revoke all on function public.fn_followup_candidates_confirmation(uuid)     from anon, authenticated;
revoke all on function public.fn_followup_candidates_pos(uuid)              from anon, authenticated;
