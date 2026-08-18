-- Encerramento deixa de ser marcado passo a passo: o ÚLTIMO passo ATIVO da régua é a despedida,
-- e ao enviá-lo o atendimento é fechado como Perdido se a chave da régua estiver ligada.
-- Decisão do dono (18/08/2026): duas chaves para a mesma ideia (o toggle no passo + a chave da
-- régua) confundem, e a tela mostrava as duas ligadas sem dizer qual mandava.
--
-- Consequências:
--   1. followup_steps.is_closing deixa de ser lido. NÃO é dropado agora de propósito: o front
--      em produção ainda é o antigo e grava nessa coluna; dropar quebraria a tela até o deploy.
--      A limpeza é uma migration posterior, depois que o front novo subir.
--   2. A trigger trg_followup_exhausted SAI. Ela era o outro caminho para Perdido, o silencioso,
--      e rodava no CLAIM (antes do envio): com a régua nova, quem fecha é sempre a edge, DEPOIS
--      de a despedida sair. Manter os dois traria de volta exatamente a confusão que estamos
--      removendo, e o caminho da trigger fechava sem mensagem.
--   3. Régua sem chave ligada não encerra nada: a cadência simplesmente acaba.
--
-- Antes desta migration, TODAS as réguas com encerramento já tinham o is_closing no último passo
-- (Vaz 1+3, Lorena 1+2, Tyago 1..3, Metaltres 1..4+6, MedDesk Demo 1+2), conferido linha a linha,
-- então a mudança é neutra para quem já usa.

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
    -- posição e TOTAL dentro da régua, entre os passos habilitados. Por ordem de propósito: com
    -- step_no absoluto, apagar/pausar um passo do meio travava a régua para sempre.
    select s.clinic_id, s.stage_id, s.message_text, s.delay_minutes,
           row_number() over (partition by s.clinic_id, s.stage_id order by s.step_no) as pos,
           count(*) over (partition by s.clinic_id, s.stage_id) as total
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
    w.phone_number, p.message_text, p.pos::int,
    -- despedida = último passo ativo, e só encerra se a régua mandar encerrar
    (p.pos = p.total and coalesce(cfg.close_ticket_on_exhaust, true)),
    ec.expected,
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
  join tickets tk on tk.lead_id = l.id and tk.status = 'open'
  join funnel_stages fs on fs.id = tk.stage_id
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
    select cm.created_at as last_in_at
      from chat_messages cm
     where g.ligado and cm.lead_id = l.id and cm.direction = 'inbound'
     order by cm.seq desc limit 1
  ) lin on true
  cross join lateral (
    select r.regua,
           (g.ligado and l.followup_ruleset_stage_id is distinct from r.regua) as trocou,
           case when g.ligado and l.followup_ruleset_stage_id is distinct from r.regua
                then 0 else l.followup_count end as expected
      from (
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
  left join followup_rulesets cfg
    on cfg.clinic_id = l.clinic_id and cfg.stage_id is not distinct from ec.regua
  where (p_clinic_id is null or l.clinic_id = p_clinic_id)
    and l.followup_enabled = true
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'reengagement')
    and l.ai_enabled = true
    and l.handoff_triggered_at is null
    and l.converted_patient_id is null
    and coalesce(l.is_not_lead, false) = false
    and l.phone is not null and l.phone <> ''
    and not exists (select 1 from tickets tg where tg.lead_id = l.id and tg.outcome = 'ganho')
    and fs.slug not in ('agendado','compareceu','ganho','perdido')
    and not exists (select 1 from appointments a join tickets t2 on t2.id = a.ticket_id
                     where t2.lead_id = l.id
                       and a.status in ('pendente','confirmado')
                       and ((a.date + a."time") at time zone 'America/Sao_Paulo') > now())
    and lm.last_dir = 'outbound'
    and lm.last_at >= ((now() at time zone 'America/Sao_Paulo')
                        - (coalesce(ac.followup_max_idle_days, 7) || ' days')::interval)
$function$;

comment on function public.fn_followup_candidates_reengagement(uuid) is
  'Candidatos ao reengajamento. Próximo passo por ORDEM dentro da régua. O último passo ativo é a despedida quando a régua manda encerrar (followup_rulesets.close_ticket_on_exhaust). Régua = etapa do ticket aberto quando ela tem régua própria e o gate reengajamento_por_etapa está ligado; senão, Padrão.';

-- Sai o caminho silencioso: agora existe UM encerramento só, feito pela edge depois do envio.
drop trigger if exists trg_followup_exhausted on public.leads;
drop function if exists public.fn_check_followup_exhausted();

comment on column public.followup_steps.is_closing is
  'LETRA MORTA desde 18/08/2026: o encerramento passou a ser posicional (último passo ativo da régua) + followup_rulesets.close_ticket_on_exhaust. Mantida só enquanto o front antigo, que ainda grava nela, não for substituído. Remover na limpeza seguinte.';
