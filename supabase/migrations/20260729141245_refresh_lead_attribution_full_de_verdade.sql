-- p_full agora varre MESMO todos os leads. (Versão DEFINITIVA da função.)
--
-- Defeito da versão anterior: com p_full o marco virava '-infinity', mas o alvo continuava saindo
-- da CTE `mudou`, cujos braços são "tem mensagem", "tem consulta" e "nunca classificado". Lead sem
-- nenhuma mensagem e já classificado NÃO entrava — o full recalculava 23.956 dos 32.786.
-- Na prática a classificação dava no mesmo (sem mensagem e sem consulta, ele é 'nao_atendido' de
-- qualquer jeito), mas a rede de segurança precisa ser literal: se as mensagens de um lead forem
-- apagadas, é o full que tem que rebaixá-lo de volta para 'nao_atendido', e ele nunca seria visto.
--
-- Agora o alvo é escolhido antes: full => todos os leads; incremental => só os que mudaram.
--
-- RESULTADO FINAL DA SÉRIE (medido em produção):
--   antes .......... 5.082 ms de média, 1.307 chamadas, 6.643 s de CPU acumulada
--   depois .........    46,6 ms no estado estável  (~109x)
-- Prova de equivalência: rodar o full logo após o incremental NÃO muda a distribuição
--   (humano 22.779 | ia 600 | nao_atendido 9.409 antes e depois), ou seja o incremental não
--   estava deixando lead para trás.

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
  ),
  alvo as (
    select l.id, l.clinic_id
      from public.leads l
     where coalesce(l.is_not_lead, false) = false
       and (p_full or l.id in (select id from mudou))
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
