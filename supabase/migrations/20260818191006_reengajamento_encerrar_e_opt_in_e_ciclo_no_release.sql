-- Correções da segunda revisão (18/08/2026). Todas verificadas no banco antes de aplicar.
--
-- (1) A AUSÊNCIA DE CONFIGURAÇÃO PASSA A SIGNIFICAR "NÃO ENCERRAR".
--
-- `coalesce(cfg.close_ticket_on_exhaust, true)` fazia toda régua SEM linha de configuração
-- encerrar o atendimento no último passo. Uma clínica que monta a cadência na mão pelo
-- "Adicionar passo" cria um passo só, esse passo é o último, logo a despedida, e a primeira
-- mensagem ("podemos continuar de onde paramos?") fechava o atendimento como Perdido.
-- Encerrar atendimento é ato destrutivo: tem que ser opt-in explícito, nunca o default de quem
-- esqueceu de configurar. As 31 réguas de hoje já têm linha explícita (backfills anteriores),
-- então isto não muda o comportamento de ninguém agora.
--
-- (2) Réguas de ETAPA que já existiam também ganham linha explícita: os dois backfills anteriores
--     filtravam `stage_id is null` e deixaram as de etapa herdando o default.
insert into public.followup_rulesets (clinic_id, stage_id, close_ticket_on_exhaust)
select s.clinic_id, s.stage_id, bool_or(s.is_closing)
  from public.followup_steps s
 where s.stage_id is not null
 group by s.clinic_id, s.stage_id
on conflict (clinic_id, stage_id) do nothing;

-- (3) Coerência, UMA VEZ SÓ: régua cujo último passo É uma despedida escrita (is_closing marcado
--     antes da mudança para posicional) mas cuja chave está desligada anuncia o fim e deixa o card
--     aberto. Alinha a chave ao que o texto promete.
--
-- ⚠️ Guardado atrás da existência de followup_steps.is_closing, que é LETRA MORTA e sai na próxima
-- limpeza. O guard existe porque este UPDATE liga encerramento a partir de um dado que a tela nova
-- nunca mais escreve: num replay depois da limpeza, ou rodando o arquivo de novo, ele poderia
-- religar o fechamento automático em réguas onde o cliente escolheu desligar — e a regra desta
-- mesma migration é que encerrar é opt-in explícito.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'followup_steps'
                and column_name = 'is_closing') then
    update public.followup_rulesets r
       set close_ticket_on_exhaust = true
     where not r.close_ticket_on_exhaust
       and exists (select 1 from public.followup_steps s
                    where s.clinic_id = r.clinic_id
                      and s.stage_id is not distinct from r.stage_id
                      and s.enabled and s.is_closing);
  end if;
end $$;

-- (4) CICLO restaurado ao devolver o passo.
--
-- O ciclo existe para a chave anti-duplicidade ser estável entre tentativas da MESMA rodada.
-- Só que o claim incrementava e o release não desfazia: se a resposta do envio se perdesse
-- depois de as linhas terem entrado na fila, a tentativa seguinte gerava chave nova e o contato
-- recebia tudo de novo. O release agora devolve o ciclo junto com o resto do estado.
create or replace function public.fn_release_reengagement_step(
  p_lead_id uuid, p_prev_count int, p_prev_stage_id uuid, p_prev_sent_at timestamp default null,
  p_prev_cycle int default null)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.leads
     set followup_count            = p_prev_count,
         followup_ruleset_stage_id = p_prev_stage_id,
         followup_sent_at          = p_prev_sent_at,
         followup_cycle            = coalesce(p_prev_cycle, followup_cycle)
   where id = p_lead_id;
  return found;
end;
$function$;

revoke all on function public.fn_release_reengagement_step(uuid, int, uuid, timestamp, int) from public, anon, authenticated;
grant execute on function public.fn_release_reengagement_step(uuid, int, uuid, timestamp, int) to service_role;

-- (5) O claim devolve o ciclo ANTERIOR também, para o release ter o que restaurar.
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
  v_prev_cycle int;
  v_new_sent timestamp;
  v_cycle int;
  v_ok int;
begin
  select followup_count, followup_ruleset_stage_id, followup_sent_at, coalesce(followup_cycle, 0)
    into v_prev_count, v_prev_stage, v_prev_sent, v_prev_cycle
    from public.leads where id = p_lead_id for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'lead_nao_encontrado');
  end if;

  update public.leads l
     set followup_count            = p_expected + 1,
         followup_sent_at          = (now() at time zone 'America/Sao_Paulo'),
         followup_ruleset_stage_id = p_stage_id,
         followup_cycle            = case when p_expected = 0 then coalesce(l.followup_cycle, 0) + 1
                                          else coalesce(l.followup_cycle, 0) end
   where l.id = p_lead_id
     and l.followup_enabled = true
     and l.ai_enabled = true
     and l.handoff_triggered_at is null
     and l.converted_patient_id is null
     and not exists (select 1 from public.lead_followup_optout o
                      where o.lead_id = l.id and o.kind = 'reengagement')
     and (
          (l.followup_ruleset_stage_id is not distinct from p_stage_id and l.followup_count = p_expected)
       or (l.followup_ruleset_stage_id is distinct from p_stage_id     and p_expected = 0)
       -- rollback do gate: com a régua por etapa desligada só o contador manda, e o próprio claim
       -- LIMPA a marca (p_stage_id chega null), devolvendo o contato ao estado antigo. Preservar a
       -- marca, como se fazia antes, deixava o log e a chave de deduplicação apontando para uma
       -- régua que não gerou aquela mensagem.
       or (not public.fn_reengajamento_por_etapa_ativo() and l.followup_count = p_expected)
     )
  returning l.followup_sent_at, l.followup_cycle into v_new_sent, v_cycle;

  get diagnostics v_ok = row_count;

  return jsonb_build_object(
    'claimed', v_ok = 1,
    'reason', case when v_ok = 1 then null else 'not_claimed' end,
    'prev_count', v_prev_count,
    'prev_stage_id', v_prev_stage,
    'prev_sent_at', v_prev_sent,
    'prev_cycle', v_prev_cycle,
    'sent_at', v_new_sent,
    'cycle', v_cycle);
end;
$function$;

revoke all on function public.fn_claim_reengagement_step(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.fn_claim_reengagement_step(uuid, uuid, int) to service_role;

-- (6) Selector: default do encerramento vira NÃO encerrar, com o gate desligado a régua devolvida
--     volta a ser a mesma que gerou os passos (sem divergência entre log/chave e mensagem), e os
--     comentários que explicam as duas regras não óbvias voltam para o corpo da função — neste
--     projeto quem lê a regra lê o `pg_get_functiondef`, não a migration.
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
    -- posição e TOTAL dentro da régua, entre os passos HABILITADOS. É por ordem de propósito:
    -- com step_no absoluto, apagar ou pausar um passo do meio travava a régua para sempre
    -- (94 contatos da Vaz ficaram parados assim, esperando um passo 2 que não existia mais).
    select s.clinic_id, s.stage_id, s.message_text, s.delay_minutes,
           row_number() over (partition by s.clinic_id, s.stage_id order by s.step_no) as pos,
           count(*) over (partition by s.clinic_id, s.stage_id) as total
      from public.followup_steps s
     where s.enabled
  ),
  reguas as (
    -- etapa com régua própria = TEM LINHA, mesmo que toda pausada. Pausar todos os passos
    -- silencia aquela etapa em vez de devolvê-la ao Padrão (decisão do dono, 18/08/2026).
    select distinct s.clinic_id, s.stage_id
      from public.followup_steps s
     where s.stage_id is not null
  )
  select
    l.clinic_id, l.id, l.name, l.phone,
    w.phone_number, p.message_text, p.pos::int,
    -- despedida = último passo ativo, e só encerra se a régua mandar encerrar.
    -- Ausência de configuração é NÃO encerrar: fechar atendimento é destrutivo e precisa de
    -- opt-in explícito, senão a primeira mensagem de uma régua recém-criada fecha o card.
    (p.pos = p.total and coalesce(cfg.close_ticket_on_exhaust, false)),
    ec.expected,
    (case when ec.trocou
          then coalesce(lin.last_in_at, lm.last_at)
          else greatest(lm.last_at, coalesce(l.followup_sent_at, lm.last_at))
     end + (p.delay_minutes || ' minutes')::interval)::timestamp,
    coalesce(ac.followup_enabled, false),
    ss.send_token is not null,
    coalesce(ac.followup_window_start, 6), coalesce(ac.followup_window_end, 22),
    -- a régua devolvida é a MESMA que gerou os passos: com o gate desligado isso é null, e o
    -- claim limpa a marca do contato. Devolver outra coisa faria o log e a chave de deduplicação
    -- nomearem uma régua que não produziu a mensagem.
    ec.regua
  from gate g
  cross join leads l
  join ai_config ac on ac.clinic_id = l.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = l.clinic_id
  -- ticket aberto + etapa dele. JOIN direto (não lateral) porque uq_tickets_one_open_per_lead
  -- garante no máximo 1 aberto por contato: medido, o lateral custava o dobro.
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
    -- âncora da régua nova: a última vez que o CONTATO falou. `g.ligado and` deixa o planner
    -- cortar isto inteiro (One-Time Filter) enquanto o gate estiver desligado.
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
  left join followup_rulesets cfg
    on cfg.clinic_id = l.clinic_id and cfg.stage_id is not distinct from ec.regua
  where (p_clinic_id is null or l.clinic_id = p_clinic_id)
    and l.followup_enabled = true
    -- opt-out por tipo (lead_followup_optout): exceção deste contato para ESTE follow-up
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'reengagement')
    and l.ai_enabled = true
    and l.handoff_triggered_at is null
    and l.converted_patient_id is null
    and coalesce(l.is_not_lead, false) = false
    -- contato comprovadamente fora do WhatsApp não entra: o envio seria bloqueado pelo Emissor
    -- e a edge leria o bloqueio como sucesso. Mesma régua de emit_message.
    and coalesce(l.whatsapp_invalid, false) = false
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

revoke all on function public.fn_followup_candidates_reengagement(uuid) from public, anon, authenticated;
revoke all on function public.process_reengagement_followup() from public, anon, authenticated;
