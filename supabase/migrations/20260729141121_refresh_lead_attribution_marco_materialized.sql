-- refresh_lead_attribution: marco passa de variável plpgsql para CTE MATERIALIZED.
--
-- Correção da migration anterior (20260729140855), que trocou o full refresh pelo incremental e
-- ficou em 859 ms quando a mesma lógica escrita como SELECT roda em 59 ms. A diferença não era a
-- lógica, era o PLANO:
--
--   * marco em variável plpgsql -> vira parâmetro de plano preparado. Depois de algumas execuções
--     o plpgsql adota GENERIC PLAN: sem conhecer o valor, ele estima muitas linhas para
--     `created_at > $1` e descarta o índice, caindo em seq scan nas 500 mil mensagens.
--   * marco em `with marco as materialized (...)` -> o valor é calculado em runtime e entra como
--     parâmetro do Bitmap Index Scan (`Index Cond: created_at > marco.m`). Medido: 59 ms.
--
-- ⚠️ Eu justifiquei o contrário na migration anterior ("por que o marco é variável e não CTE"),
-- baseado num teste que media CTE **sem `materialized` e antes de existir o índice** (9.058 ms).
-- Com `as materialized` + `idx_chat_messages_created_at`, a CTE é a forma certa. Fica o registro
-- para ninguém "voltar para variável" achando que melhora.
--
-- `as materialized` é obrigatório e não é enfeite: sem ele o planner inlina a CTE, o marco volta a
-- ser recalculado dentro do join e o plano degenera para Nested Loop com Join Filter.
--
-- Nada mais muda: mesma classificação, mesmos três braços de "mudou", mesmo p_full.
--
-- SUPERADA por 20260729141245 (que faz o p_full varrer mesmo todos os leads). O corpo definitivo
-- está lá; este arquivo fica pelo registro do porquê do MATERIALIZED.

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
    select case
             when p_full then '-infinity'::timestamp
             else (select coalesce(max(computed_at), '-infinity'::timestamptz)
                     from public.lead_kpi_attribution) at time zone 'America/Sao_Paulo'
           end as m
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
  perform log_system_error('cron','LEAD_ATTRIBUTION_REFRESH_FAIL',
    'refresh_lead_attribution falhou: '||sqlerrm, 'error', null,
    jsonb_build_object('sqlstate', sqlstate, 'full', p_full), true);
  return -1;
end;
$function$;
