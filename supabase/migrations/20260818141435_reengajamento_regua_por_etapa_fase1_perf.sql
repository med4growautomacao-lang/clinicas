-- Ajuste de performance do selector de reengajamento.
-- A versão anterior chamava fn_reengajamento_por_etapa_ativo() 3x POR LINHA e sempre
-- executava o lateral da âncora de inbound, mesmo com o gate desligado (462ms -> 859ms).
-- Aqui o gate é lido UMA vez (CTE) e o lateral do inbound fica atrás de um CASE/filtro
-- que o planner corta com One-Time Filter quando o gate está off.
-- create or replace preserva as ACLs (o revoke da migration anterior continua valendo).
--
-- NOTA: este ajuste sozinho não resolveu (859ms -> 868ms). O gargalo real era o
-- `join lateral` do ticket aberto, tratado na migration seguinte (..._perf2).

create or replace function public.fn_followup_candidates_reengagement(p_clinic_id uuid default null)
returns table(
  clinic_id uuid, lead_id uuid, nome text, telefone text, clinic_phone text,
  message_text text, step_no integer, is_closing boolean, expected_count integer,
  eligible_at timestamp without time zone, toggle_on boolean, wa_ok boolean,
  window_start integer, window_end integer, ruleset_stage_id uuid)
language sql
stable
set search_path to 'public'
as $function$
  with gate as (
    select public.fn_reengajamento_por_etapa_ativo() as ligado
  ),
  passos as (
    -- posição dentro da régua entre os passos HABILITADOS. É por ordem de propósito:
    -- com step_no absoluto, apagar/pausar um passo do meio travava a régua para sempre.
    select s.clinic_id, s.stage_id, s.message_text, s.delay_minutes, s.is_closing,
           row_number() over (partition by s.clinic_id, s.stage_id order by s.step_no) as pos
      from public.followup_steps s
     where s.enabled
  ),
  reguas as (
    -- etapa com régua própria = tem linha, mesmo que toda pausada (pausar tudo = silêncio)
    select distinct s.clinic_id, s.stage_id
      from public.followup_steps s
     where s.stage_id is not null
  )
  select
    l.clinic_id, l.id, l.name, l.phone,
    w.phone_number, p.message_text, p.pos::int, p.is_closing, ec.expected,
    (case when ec.trocou
          then coalesce(lin.last_in_at, lm.last_at)
          else greatest(lm.last_at, coalesce(l.followup_sent_at, lm.last_at))
     end + (p.delay_minutes || ' minutes')::interval)::timestamp,
    coalesce(ac.followup_enabled, false),
    ss.send_token is not null,
    coalesce(ac.followup_window_start, 6), coalesce(ac.followup_window_end, 22),
    ec.regua
  from gate g
  cross join leads l
  join ai_config ac on ac.clinic_id = l.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = l.clinic_id
  join lateral (
    select wi.phone_number from whatsapp_instances wi where wi.clinic_id = l.clinic_id
     order by (wi.status = 'connected') desc nulls last limit 1
  ) w on true
  join lateral (
    select cm.direction as last_dir, cm.created_at as last_at
      from chat_messages cm where cm.lead_id = l.id
     order by cm.seq desc limit 1
  ) lm on true
  left join lateral (
    -- âncora da régua nova: a última vez que o CONTATO falou (idx_chat_messages_lead_inbound).
    -- `g.ligado and` no where deixa o planner cortar isso inteiro com o gate desligado.
    select cm.created_at as last_in_at
      from chat_messages cm
     where g.ligado and cm.lead_id = l.id and cm.direction = 'inbound'
     order by cm.seq desc limit 1
  ) lin on true
  join lateral (
    -- uq_tickets_one_open_per_lead garante no máximo 1 aberto; ticket sem etapa fica de fora
    select t.stage_id, fs.slug
      from tickets t join funnel_stages fs on fs.id = t.stage_id
     where t.lead_id = l.id and t.status = 'open'
     limit 1
  ) tk on true
  cross join lateral (
    select r.regua,
           (g.ligado and l.followup_ruleset_stage_id is distinct from r.regua) as trocou,
           case when g.ligado and l.followup_ruleset_stage_id is distinct from r.regua
                then 0 else l.followup_count end as expected
      from (
        -- CASE aninhado de propósito: com o gate off nem chega a procurar régua de etapa
        select case when g.ligado
                    then (select case when exists (select 1 from reguas gg
                                                    where gg.clinic_id = l.clinic_id
                                                      and gg.stage_id = tk.stage_id)
                                      then tk.stage_id end)
               end as regua
      ) r
  ) ec
  join passos p
    on p.clinic_id = l.clinic_id
   and p.stage_id is not distinct from ec.regua
   and p.pos = ec.expected + 1
  where (p_clinic_id is null or l.clinic_id = p_clinic_id)
    and l.followup_enabled = true
    -- opt-out por tipo (lead_followup_optout): exceção deste lead para ESTE follow-up
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'reengagement')
    and l.ai_enabled = true
    and l.handoff_triggered_at is null
    and l.converted_patient_id is null
    and coalesce(l.is_not_lead, false) = false
    and l.phone is not null and l.phone <> ''
    and not exists (select 1 from tickets t where t.lead_id = l.id and t.outcome = 'ganho')
    and tk.slug not in ('agendado','compareceu','ganho','perdido')
    and not exists (select 1 from appointments a join tickets t2 on t2.id = a.ticket_id
                     where t2.lead_id = l.id
                       and a.status in ('pendente','confirmado')
                       and ((a.date + a."time") at time zone 'America/Sao_Paulo') > now())
    and lm.last_dir = 'outbound'
    and lm.last_at >= ((now() at time zone 'America/Sao_Paulo')
                        - (coalesce(ac.followup_max_idle_days, 7) || ' days')::interval)
$function$;
