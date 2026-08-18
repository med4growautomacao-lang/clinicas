-- ============================================================================
-- Reengajamento: régua POR ETAPA do funil (fase 1 = banco)
--
-- O que muda:
--   1. followup_steps ganha stage_id. NULL = régua PADRÃO (a de hoje, para toda
--      etapa sem régua própria). Nenhuma linha existente é tocada.
--   2. O próximo passo passa a ser resolvido por ORDEM, não por step_no absoluto.
--      Buraco na numeração travava a régua (94 contatos da Vaz parados em count=1
--      esperando um passo 2 apagado, com o encerramento no passo 3 inalcançável).
--   3. leads.followup_ruleset_stage_id guarda em QUAL régua o contato está. Trocou
--      de régua => contagem do zero, ancorada na ÚLTIMA MENSAGEM DO CONTATO.
--   4. Encerramento (is_closing) e fallback de "esgotou" passam a ser POR RÉGUA.
--      O fallback (marcar Perdido sem mensagem) ganha chave, default = hoje.
--
-- GATE: a lógica por etapa só entra em vigor com system_settings
-- 'reengajamento_por_etapa'.ativo = true. Enquanto false, tudo resolve para a
-- régua Padrão e o comportamento é o anterior. Ligar SÓ depois da edge (fase 2).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (0) Gate de rollout
-- ---------------------------------------------------------------------------
insert into public.system_settings (id, value, description)
values (
  'reengajamento_por_etapa',
  jsonb_build_object('ativo', false)::text,
  'Liga a régua de reengajamento por etapa do funil. Enquanto false, toda etapa usa a régua Padrão (followup_steps.stage_id null) e o comportamento é o anterior. Só ligar depois que a edge reengagement-followup gravar leads.followup_ruleset_stage_id via fn_claim_reengagement_step: sem isso a régua reinicia a cada tick.'
)
on conflict (id) do nothing;

create or replace function public.fn_reengajamento_por_etapa_ativo()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select (value::jsonb->>'ativo')::boolean from public.system_settings where id = 'reengajamento_por_etapa'),
    false)
$$;

-- ---------------------------------------------------------------------------
-- (1) followup_steps: dono da régua + unicidade por régua
-- ---------------------------------------------------------------------------
alter table public.followup_steps add column if not exists stage_id uuid;

comment on column public.followup_steps.stage_id is
  'Etapa do funil dona desta régua. NULL = régua Padrão (vale para toda etapa sem régua própria). Existir linha para uma etapa (mesmo toda pausada) significa que a etapa TEM régua própria: pausar tudo silencia a etapa em vez de cair no Padrão.';

-- A RLS de followup_steps valida clinic_id, mas não que a etapa é da mesma clínica.
-- FK composta fecha isso sem trigger (MATCH SIMPLE: com stage_id NULL não é checada).
create unique index if not exists uq_funnel_stages_clinic_id
  on public.funnel_stages (clinic_id, id);

alter table public.followup_steps drop constraint if exists followup_steps_stage_fk;
alter table public.followup_steps
  add constraint followup_steps_stage_fk
  foreign key (clinic_id, stage_id)
  references public.funnel_stages (clinic_id, id)
  on delete cascade;

-- passo único por RÉGUA (nulls not distinct: o Padrão é um valor, não "qualquer um")
alter table public.followup_steps drop constraint if exists followup_steps_clinic_id_step_no_key;
create unique index if not exists uq_followup_steps_regua_step
  on public.followup_steps (clinic_id, stage_id, step_no) nulls not distinct;

-- encerramento: era 1 por clínica, passa a ser 1 por RÉGUA
drop index if exists public.uq_followup_steps_one_closing;
create unique index if not exists uq_followup_steps_one_closing
  on public.followup_steps (clinic_id, stage_id) nulls not distinct
  where is_closing;

-- ---------------------------------------------------------------------------
-- (2) leads: em que régua o contato está
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists followup_ruleset_stage_id uuid;

alter table public.leads drop constraint if exists leads_followup_ruleset_stage_fk;
alter table public.leads
  add constraint leads_followup_ruleset_stage_fk
  foreign key (followup_ruleset_stage_id)
  references public.funnel_stages (id)
  on delete set null;

comment on column public.leads.followup_ruleset_stage_id is
  'Régua de reengajamento em que este contato está (NULL = Padrão). Escrita por fn_claim_reengagement_step. Se a régua efetiva do card mudar, o contador volta a zero e a contagem passa a ser ancorada na última mensagem do contato.';

-- ---------------------------------------------------------------------------
-- (3) chave do fallback "esgotou a régua => Perdido"
--     Hoje esse caminho não tem chave nenhuma: default true = comportamento atual.
--     (O passo com bandeira de encerramento continua sendo outra coisa: manda a
--      despedida e FECHA o ticket via finalize_ticket.)
-- ---------------------------------------------------------------------------
alter table public.ai_config
  add column if not exists followup_close_ticket_on_exhaust boolean not null default true;

comment on column public.ai_config.followup_close_ticket_on_exhaust is
  'Ao esgotar a régua SEM passo de encerramento, marcar o ticket como Perdido (sem mensagem). Default true = comportamento histórico de fn_check_followup_exhausted.';

-- ---------------------------------------------------------------------------
-- (4) Selector: próximo passo por ORDEM + régua da etapa
--     ATENÇÃO: esta versão foi substituída na mesma sessão pelas migrations
--     ..._perf e ..._perf2 (ganho de performance). Mantida aqui como história.
-- ---------------------------------------------------------------------------
drop function if exists public.fn_followup_candidates_reengagement(uuid);

create function public.fn_followup_candidates_reengagement(p_clinic_id uuid default null)
returns table(
  clinic_id uuid, lead_id uuid, nome text, telefone text, clinic_phone text,
  message_text text, step_no integer, is_closing boolean, expected_count integer,
  eligible_at timestamp without time zone, toggle_on boolean, wa_ok boolean,
  window_start integer, window_end integer, ruleset_stage_id uuid)
language sql
stable
set search_path to 'public'
as $function$
  with passos as (
    select s.clinic_id, s.stage_id, s.message_text, s.delay_minutes, s.is_closing,
           row_number() over (partition by s.clinic_id, s.stage_id order by s.step_no) as pos
      from public.followup_steps s
     where s.enabled
  ),
  reguas as (
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
  from leads l
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
    select cm.created_at as last_in_at
      from chat_messages cm where cm.lead_id = l.id and cm.direction = 'inbound'
     order by cm.seq desc limit 1
  ) lin on true
  join lateral (
    select t.stage_id, fs.slug
      from tickets t join funnel_stages fs on fs.id = t.stage_id
     where t.lead_id = l.id and t.status = 'open'
     limit 1
  ) tk on true
  cross join lateral (
    select r.regua,
           case when public.fn_reengajamento_por_etapa_ativo()
                then (l.followup_ruleset_stage_id is distinct from r.regua)
                else false end as trocou,
           case when public.fn_reengajamento_por_etapa_ativo()
                 and (l.followup_ruleset_stage_id is distinct from r.regua)
                then 0 else l.followup_count end as expected
      from (
        select case when public.fn_reengajamento_por_etapa_ativo()
                     and exists (select 1 from reguas g
                                  where g.clinic_id = l.clinic_id and g.stage_id = tk.stage_id)
                    then tk.stage_id else null end as regua
      ) r
  ) ec
  join passos p
    on p.clinic_id = l.clinic_id
   and p.stage_id is not distinct from ec.regua
   and p.pos = ec.expected + 1
  where (p_clinic_id is null or l.clinic_id = p_clinic_id)
    and l.followup_enabled = true
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

comment on function public.fn_followup_candidates_reengagement(uuid) is
  'Candidatos ao reengajamento. Próximo passo por ORDEM dentro da régua (não por step_no). Régua = etapa do ticket aberto quando ela tem régua própria e o gate reengajamento_por_etapa está ligado; senão, Padrão (stage_id null).';

revoke all on function public.fn_followup_candidates_reengagement(uuid) from public, anon, authenticated;
revoke all on function public.fn_reengajamento_por_etapa_ativo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- (5) Claim atômico (contador E régua na mesma condição) + devolução do passo
-- ---------------------------------------------------------------------------
create or replace function public.fn_claim_reengagement_step(
  p_lead_id uuid, p_stage_id uuid, p_expected int)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prev_count int;
  v_prev_stage uuid;
  v_prev_sent timestamp;
  v_ok int;
begin
  select followup_count, followup_ruleset_stage_id, followup_sent_at
    into v_prev_count, v_prev_stage, v_prev_sent
    from public.leads where id = p_lead_id for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'lead_nao_encontrado');
  end if;

  update public.leads l
     set followup_count            = p_expected + 1,
         followup_sent_at          = (now() at time zone 'America/Sao_Paulo'),
         followup_ruleset_stage_id = p_stage_id
   where l.id = p_lead_id
     and l.followup_enabled = true
     and l.ai_enabled = true
     and l.handoff_triggered_at is null
     and l.converted_patient_id is null
     -- fecha a janela conhecida entre listar e enviar: opt-out novo é respeitado aqui
     and not exists (select 1 from public.lead_followup_optout o
                      where o.lead_id = l.id and o.kind = 'reengagement')
     and (
          (l.followup_ruleset_stage_id is not distinct from p_stage_id and l.followup_count = p_expected)
       or (l.followup_ruleset_stage_id is distinct from p_stage_id     and p_expected = 0)
     );

  get diagnostics v_ok = row_count;

  return jsonb_build_object(
    'claimed', v_ok = 1,
    'reason', case when v_ok = 1 then null else 'not_claimed' end,
    'prev_count', v_prev_count,
    'prev_stage_id', v_prev_stage,
    'prev_sent_at', v_prev_sent);
end;
$function$;

comment on function public.fn_claim_reengagement_step(uuid, uuid, int) is
  'Claim atômico de um passo do reengajamento. Compara contador E régua: quando a régua muda, o passo válido é o primeiro (p_expected = 0). Devolve o estado anterior para fn_release_reengagement_step poder devolver o passo à fila.';

create or replace function public.fn_release_reengagement_step(
  p_lead_id uuid, p_prev_count int, p_prev_stage_id uuid, p_prev_sent_at timestamp default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.leads
     set followup_count            = p_prev_count,
         followup_ruleset_stage_id = p_prev_stage_id,
         followup_sent_at          = p_prev_sent_at
   where id = p_lead_id;
  return found;
end;
$function$;

comment on function public.fn_release_reengagement_step(uuid, int, uuid, timestamp) is
  'Devolve o passo à régua quando o envio não aconteceu (contato respondeu no meio, falha ao enfileirar). Sem isto o passo seria consumido sem ter sido enviado.';

revoke all on function public.fn_claim_reengagement_step(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.fn_release_reengagement_step(uuid, int, uuid, timestamp) from public, anon, authenticated;
grant execute on function public.fn_claim_reengagement_step(uuid, uuid, int) to service_role;
grant execute on function public.fn_release_reengagement_step(uuid, int, uuid, timestamp) to service_role;

-- ---------------------------------------------------------------------------
-- (6) Cron: leva a régua no payload (a edge antiga ignora campo extra)
-- ---------------------------------------------------------------------------
create or replace function public.process_reengagement_followup()
returns void
language plpgsql
set search_path to 'public', 'extensions'
as $function$
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
         and c.eligible_at <= v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    v_payload := jsonb_build_object(
      'lead_id', r.lead_id, 'clinic_id', r.clinic_id, 'name', r.nome, 'phone', r.telefone,
      'clinic_phone', r.clinic_phone, 'message_text', r.message_text,
      'step_no', r.step_no, 'is_closing', r.is_closing, 'expected_count', r.expected_count,
      'ruleset_stage_id', r.ruleset_stage_id);
    perform public.system_http_post(
      url := v_url, headers := jsonb_build_object('Content-Type','application/json'), body := v_payload);
  end loop;
exception when others then
  perform log_system_error('reengajamento','job_failed','Falha no job de reengajamento','error',
    null, jsonb_build_object('detail', sqlerrm, 'sqlstate', sqlstate), false);
  raise;
end; $function$;

-- ---------------------------------------------------------------------------
-- (7) Esgotamento: conta os passos da RÉGUA do contato, e respeita a chave nova
-- ---------------------------------------------------------------------------
create or replace function public.fn_check_followup_exhausted()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_total int;
  v_has_closing boolean;
  v_perdido_id uuid;
  v_fechar boolean;
begin
  if NEW.followup_count = OLD.followup_count then return NEW; end if;

  -- Escopo é a RÉGUA do contato (NULL = Padrão), não a clínica inteira: com réguas por
  -- etapa, contar todos os passos da clínica nunca consideraria uma régua curta esgotada,
  -- e um encerramento em OUTRA etapa cancelaria este fallback.
  select count(*) filter (where enabled),
         coalesce(bool_or(enabled and is_closing), false)
    into v_total, v_has_closing
  from public.followup_steps
  where clinic_id = NEW.clinic_id
    and stage_id is not distinct from NEW.followup_ruleset_stage_id;

  -- com passo de encerramento, quem fecha é a edge (despedida + finalize_ticket)
  if v_has_closing then return NEW; end if;

  if v_total is null or v_total = 0 or NEW.followup_count < v_total then
    return NEW;
  end if;

  select coalesce(followup_close_ticket_on_exhaust, true) into v_fechar
    from public.ai_config where clinic_id = NEW.clinic_id;
  if not coalesce(v_fechar, true) then return NEW; end if;

  select id into v_perdido_id
  from public.funnel_stages
  where clinic_id = NEW.clinic_id and slug = 'perdido'
  limit 1;

  if v_perdido_id is not null then
    update public.tickets
      set stage_id         = v_perdido_id,
          loss_reason      = coalesce(loss_reason, 'Tentativas de follow-up esgotadas'),
          loss_reason_slug = coalesce(loss_reason_slug, 'sem_resposta')
      where lead_id = NEW.id and status = 'open';
    NEW.loss_reason := 'Tentativas de follow-up esgotadas';
  end if;

  return NEW;
end;
$function$;

-- ---------------------------------------------------------------------------
-- (8) Ticket novo: limpa a régua junto do contador (senão o próximo tick lê a
--     régua velha e reinicia duas vezes). A carência de 3 dias continua igual.
-- ---------------------------------------------------------------------------
create or replace function public.fn_reset_followup_on_new_ticket()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
BEGIN
  IF NEW.status = 'open' THEN
    UPDATE public.leads
      SET handoff_triggered_at = NULL
      WHERE id = NEW.lead_id
        AND handoff_triggered_at IS NOT NULL;

    UPDATE public.leads
      SET followup_count            = 0,
          followup_sent_at          = NULL,
          followup_ruleset_stage_id = NULL
      WHERE id = NEW.lead_id
        AND (followup_count <> 0 OR followup_sent_at IS NOT NULL OR followup_ruleset_stage_id IS NOT NULL)
        AND (
          followup_sent_at IS NULL
          OR followup_sent_at < ((now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 days')
        );
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- (9) Índice da âncora de inbound. Em produção já foi criado CONCURRENTLY (chat_messages
--     tem 551k linhas / 401 MB e CREATE INDEX comum bloqueia a chegada de mensagem).
--     Aqui fica para banco novo; em produção o IF NOT EXISTS não faz nada.
-- ---------------------------------------------------------------------------
create index if not exists idx_chat_messages_lead_inbound
  on public.chat_messages (lead_id, seq desc) where direction = 'inbound';
