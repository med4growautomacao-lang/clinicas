-- refresh_lead_attribution: de full refresh a cada 10 min para incremental.
--
-- ⚠️ ESTE ARQUIVO FOI SUPERADO no mesmo dia. Ele registra o passo 1 de três; o corpo que está
-- rodando é o de 20260729141245. Não copie a função daqui, e leia com ressalva o parágrafo
-- "POR QUE O MARCO É VARIÁVEL E NÃO CTE" abaixo: a conclusão dele está ERRADA.
--   * 20260729141121 -> marco vira `CTE as materialized`. Em variável plpgsql a query fica em
--     859 ms, porque o plano preparado adota generic plan e descarta o índice; como CTE
--     materializada, 59 ms.
--   * 20260729141245 -> `p_full` passa a varrer mesmo TODOS os leads (aqui ele ainda saía da CTE
--     `mudou` e cobria 23.956 dos 32.786).
-- Resultado final da série: 5.082 ms -> 46,6 ms.
--
-- O PROBLEMA (medido em pg_stat_statements): era o maior consumidor de CPU do banco.
--     mean 5.082 ms  x  1.307 chamadas  =  6.643 s de CPU (1h50)
-- A cada 10 minutos ela agregava as **500 mil linhas** de `chat_messages`, varria `appointments`,
-- varria os 32 mil `leads` e reescrevia as **32.318 linhas** de `lead_kpi_attribution` — mesmo
-- quando nada tinha mudado (na janela medida: 0 mensagens novas, 0 leads novos).
--
-- Isso não era só desperdício: era a causa dos timeouts que sobraram DEPOIS dos consertos de RLS
-- desta semana. Com o cron ocupando a CPU, uma query de usuário de 33 ms passava dos 8 s de
-- `statement_timeout` e o painel voltava vazio. Explica o `TICKETS_FETCH_FAIL` das 18:25 e o
-- `get_dashboard_stats` com 57014 das 19:20, ambos posteriores ao piloto de RLS.
--
-- ⚠️ MISTURA DE TIPOS (a armadilha do CLAUDE.md §3, e ela morde exatamente aqui):
--     lead_kpi_attribution.computed_at  -> timestamptz
--     chat_messages.created_at          -> timestamp SEM tz (já em SP)
--     appointments.created_at, leads.created_at -> idem
-- Comparar cru desloca 3h, e aqui isso não dá erro: faz o incremental PULAR lead que mudou (some
-- do painel) ou reprocessar de graça. Por isso o marco é convertido uma vez, com
-- `at time zone 'America/Sao_Paulo'`, e guardado numa variável `timestamp` sem tz.
--
-- ⚠️ POR QUE O MARCO É VARIÁVEL E NÃO CTE: com o marco vindo de uma CTE o planner monta
-- `Nested Loop` com `Join Filter` e varre as 500 mil mensagens (medido: 9.058 ms). Como valor
-- escalar, ele usa o índice novo de `created_at`. Duas formas que parecem equivalentes em SQL e
-- diferem em duas ordens de grandeza.
--
-- Uma tentativa que MEDI E DESCARTEI, para ninguém repetir: manter o "varre todos os leads e
-- pergunta se mudou" com `exists (... cm.created_at > k.computed_at)` por linha. O conjunto-alvo
-- fica certo (37 leads), mas achá-lo custa 4.690 ms, porque o EXISTS roda 32.779 vezes. Tem que
-- partir do que mudou, não perguntar a cada lead se ele mudou.
--
-- SEMÂNTICA: a classificação (ia / humano / nao_atendido) é **idêntica** à anterior, copiada linha
-- a linha. O que muda é só QUAIS leads entram no cálculo.
--
-- REDE DE SEGURANÇA: mensagem importada com data ANTIGA (onboarding traz histórico) nasce abaixo
-- do marco e não seria pega pelo incremental. Por isso `p_full => true` continua existindo e passa
-- a rodar 1x por dia às 4h (cron novo), quando o banco está ocioso. O cron de 10 em 10 minutos
-- segue chamando `refresh_lead_attribution()` sem argumento, agora incremental.

-- 1. Índice que torna o corte por data barato ----------------------------------
-- Sem ele o braço de chat_messages é seq scan em 500 mil linhas. Não é CONCURRENTLY porque
-- migration roda em transação; em 500 mil linhas leva ~1-2 s, e o INSERT que cair nesse instante
-- espera o lock em vez de falhar (a edge wa-inbound tem retry).
create index if not exists idx_chat_messages_created_at
  on public.chat_messages (created_at)
  where lead_id is not null;

-- 2. A função ------------------------------------------------------------------
-- Drop antes do create: a assinatura muda (ganha p_full com default). Mantendo as duas, a chamada
-- sem argumento do cron 17 ficaria ambígua e o cron passaria a falhar.
drop function if exists public.refresh_lead_attribution();

create or replace function public.refresh_lead_attribution(p_full boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
  v_marco timestamp;   -- SEM tz de propósito: mesma régua de chat_messages/appointments/leads
begin
  if p_full then
    v_marco := '-infinity'::timestamp;
  else
    v_marco := (select coalesce(max(computed_at), '-infinity'::timestamptz)
                  from public.lead_kpi_attribution) at time zone 'America/Sao_Paulo';
  end if;

  insert into public.lead_kpi_attribution (lead_id, clinic_id, agent, computed_at)
  with mudou as (
    -- lead que recebeu mensagem depois do último cálculo
    select cm.lead_id as id
      from public.chat_messages cm
     where cm.lead_id is not null and cm.created_at > v_marco
    union
    -- lead cujo ticket ganhou consulta depois do último cálculo
    select t.lead_id
      from public.appointments a
      join public.tickets t on t.id = a.ticket_id
     where t.lead_id is not null and a.created_at > v_marco
    union
    -- lead que nunca foi classificado (inclui os criados desde o último cálculo)
    select l0.id
      from public.leads l0
     where coalesce(l0.is_not_lead, false) = false
       and not exists (select 1 from public.lead_kpi_attribution k where k.lead_id = l0.id)
  ),
  alvo as (
    select l.id, l.clinic_id
      from public.leads l
      join mudou on mudou.id = l.id
     where coalesce(l.is_not_lead, false) = false
  ),
  first_appt as (
    select distinct on (t.lead_id) t.lead_id, a.source
      from public.appointments a
      join public.tickets t on t.id = a.ticket_id
      join alvo on alvo.id = t.lead_id
     where a.source is not null
     order by t.lead_id, a.created_at asc
  ),
  msg as (
    select cm.lead_id,
           count(*) filter (where cm.sender = 'ai') as ai_out,
           count(*) filter (where cm.sender = 'human' and cm.direction = 'outbound') as human_out
      from public.chat_messages cm
      join alvo on alvo.id = cm.lead_id
     group by cm.lead_id
  )
  select alvo.id, alvo.clinic_id,
    case
      when fa.source = 'ia' then 'ia'
      when fa.source = 'manual' then 'humano'
      when coalesce(m.ai_out,0) + coalesce(m.human_out,0) > 0
        then case when coalesce(m.ai_out,0) >= coalesce(m.human_out,0) then 'ia' else 'humano' end
      else 'nao_atendido'
    end,
    now()
  from alvo
  left join first_appt fa on fa.lead_id = alvo.id
  left join msg m on m.lead_id = alvo.id
  on conflict (lead_id) do update
    set agent = excluded.agent, clinic_id = excluded.clinic_id, computed_at = now();

  get diagnostics v_count = row_count;
  return v_count;
exception when others then
  -- Falha do refresh = atribuição fica STALE (dashboards seguem com o valor anterior). O EXCEPTION
  -- rola de volta ao savepoint, então o log PERSISTE.
  perform log_system_error('cron','LEAD_ATTRIBUTION_REFRESH_FAIL',
    'refresh_lead_attribution falhou: '||sqlerrm, 'error', null,
    jsonb_build_object('sqlstate', sqlstate, 'full', p_full), true);
  return -1;
end;
$function$;

comment on function public.refresh_lead_attribution(boolean) is
  'Recalcula lead_kpi_attribution. Sem argumento = INCREMENTAL (só leads com mensagem/consulta nova desde o max(computed_at), mais os nunca classificados) — é o que o cron de 10 min chama. p_full => true varre tudo, e roda 1x/dia às 4h para cobrir mensagem importada com data retroativa.';

revoke all on function public.refresh_lead_attribution(boolean) from public, anon, authenticated;
grant execute on function public.refresh_lead_attribution(boolean) to service_role;

-- 3. Varredura completa diária, de madrugada -----------------------------------
select cron.schedule(
  'refresh_lead_attribution_full',
  '0 7 * * *',   -- 07:00 UTC = 04:00 America/Sao_Paulo
  $cron$select public.refresh_lead_attribution(true);$cron$
);
