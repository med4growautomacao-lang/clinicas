-- O cron de atribuicao (a cada 10 min) estava levando 7,2 SEGUNDOS mesmo com 2 mensagens novas
-- para reprocessar. Medido hoje: 30/07 09:40:00 ele levou 8,6 s, e o painel da Metaltres morreu
-- as 09:41 com "canceling statement due to statement timeout" (o teto do app e 8 s). Nao e
-- coincidencia: quinze rotinas comecam no mesmo segundo dos minutos redondos, e esta era a mais
-- pesada de todas.
--
-- CAUSA: `and (p_full or l.id in (select id from mudou))`. p_full e VARIAVEL de plpgsql. Depois
-- da 5a execucao o Postgres troca o plano especifico pelo GENERICO, e no plano generico ele nao
-- pode assumir que p_full e falso: precisa de um plano que sirva tambem para "todos os leads".
-- O resultado e um plano que varre lead e mensagem inteiras a cada 10 minutos para atualizar
-- meia duzia de linhas. Mesma armadilha ja registrada na otimizacao de 29/07, so que um andar
-- acima: la era o marco, aqui e o proprio interruptor da varredura completa.
--
-- PROVA (medida antes e depois, mesmo dado):
--   dentro da funcao, com p_full como variavel .... 7.252 ms
--   a mesma consulta com o literal `false` ........... 89 ms
--   depois desta migration, 6a chamada seguida ....... 55 ms   (130x)
--
-- EQUIVALENCIA CONFERIDA: rodou-se refresh_lead_attribution(true) e comparou-se a tabela inteira
-- com a formula original escrita a mao: 33.050 leads conferidos, 0 divergentes.
--
-- CORRECAO: tirar p_full do filtro linha a linha e transforma-lo num RAMO do `mudou`. Como o
-- `where p_full` nao olha nenhuma coluna, o Postgres monta um "One-Time Filter": com p_full
-- falso, aquele ramo nao chega a tocar a tabela. O `alvo` volta a ser sempre "quem esta em
-- mudou", que e a forma que o planner sabe resolver por indice.
--
-- ⚠️ NAO reescrever isto como `(select p_full)` nem voltar o OR para dentro do where do alvo: as
-- duas formas devolvem o numero certo e trazem o plano ruim de volta, sem erro nenhum aparecer.
create or replace function public.refresh_lead_attribution(p_full boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer;
begin
  insert into public.lead_kpi_attribution (lead_id, clinic_id, agent, computed_at)
  with marco as materialized (
    -- timestamptz -> timestamp SEM tz, que é a régua de chat_messages/appointments/leads.
    -- Comparar cru desloca 3h e faz o incremental pular lead que mudou (CLAUDE.md §3).
    -- MATERIALIZED é obrigatório: sem ele o planner inlina, o marco é recalculado dentro do join
    -- e o plano cai em Nested Loop com seq scan nas 500 mil mensagens.
    select (select coalesce(max(computed_at), '-infinity'::timestamptz)
              from public.lead_kpi_attribution) at time zone 'America/Sao_Paulo' as m
  ),
  mudou as (
    select cm.lead_id as id
      from public.chat_messages cm, marco
     where cm.lead_id is not null and cm.created_at > marco.m
    union
    select t.lead_id
      from public.appointments a
      join public.tickets t on t.id = a.ticket_id, marco
     where t.lead_id is not null and a.created_at > marco.m
    union
    select l0.id
      from public.leads l0
     where coalesce(l0.is_not_lead, false) = false
       and not exists (select 1 from public.lead_kpi_attribution k where k.lead_id = l0.id)
    union
    -- Varredura completa, e SÓ quando pedida. `p_full` sozinho não olha coluna nenhuma, então
    -- vira One-Time Filter: com false, este ramo não lê a tabela. É isso que mantém o plano do
    -- incremental por índice em vez de genérico.
    select l1.id
      from public.leads l1
     where p_full
       and coalesce(l1.is_not_lead, false) = false
  ),
  alvo as (
    select l.id, l.clinic_id
      from public.leads l
     where coalesce(l.is_not_lead, false) = false
       and l.id in (select id from mudou)
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
  perform log_system_error('cron','LEAD_ATTRIBUTION_REFRESH_FAIL',
    'refresh_lead_attribution falhou: '||sqlerrm, 'error', null,
    jsonb_build_object('sqlstate', sqlstate, 'full', p_full), true);
  return -1;
end;
$function$;

-- Junto com esta migration, o job mais pesado do topo da hora saiu do horario de pico:
--   cron.alter_job(36, schedule => '25 */3 * * *')   -- conv_ai_mechanical_sweep, era '0 */3'
-- Ele levou 63,6 s em 29/07 15:00:03, no mesmo segundo de outras 14 rotinas. O monitor de
-- "cron parado" nao enxerga esse formato de agenda nem antes nem depois, entao nada muda la.
