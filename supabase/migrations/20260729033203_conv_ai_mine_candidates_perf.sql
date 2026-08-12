-- 20260729033203_conv_ai_mine_candidates_perf
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Otimização do minerador: só 3/4-gramas (2-gramas eram os mais numerosos e ruidosos;
-- "vou encerrar este" cobre o mesmo sinal), cap de 60 palavras por mensagem, e folga de
-- statement_timeout na função (é job de fundo diário, não é latência de request).
create or replace function public.conv_ai_mine_candidates(
  p_clinic_id  uuid,
  p_min_support int default 8,
  p_side       text default 'outbound'
) returns table(
  gram text, leads int, ganho int, perdido int, pct_ganho numeric, base_ganho numeric, lift numeric
)
language sql
stable
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
with base as (
  select t.lead_id,
    max(case when t.outcome='ganho' then 3 when t.outcome='perdido' then 2 else 1 end) as oc
  from tickets t where t.clinic_id = p_clinic_id group by t.lead_id
),
lo as (
  select lead_id, case oc when 3 then 'ganho' when 2 then 'perdido' end as outcome
  from base where oc in (2,3)
),
base_rate as (select coalesce(avg((outcome='ganho')::int)::numeric, 0) as r from lo),
msgs as (
  select cm.lead_id, string_to_array(public.normalize_stage_text(cm.message->>'content'),' ') as w
  from chat_messages cm join lo on lo.lead_id = cm.lead_id
  where cm.clinic_id = p_clinic_id and cm.direction = p_side
    and coalesce(btrim(cm.message->>'content'),'') <> ''
),
grams as (
  select m.lead_id, array_to_string(m.w[i : i + k.n - 1], ' ') as g
  from msgs m
  cross join (values (3),(4)) as k(n)
  cross join generate_subscripts(m.w,1) as i
  where array_length(m.w,1) >= k.n
    and i <= 60
    and i + k.n - 1 <= array_length(m.w,1)
),
lg as (
  select distinct g.lead_id, g.g, lo.outcome
  from grams g join lo on lo.lead_id = g.lead_id
  where length(g.g) >= 8
),
agg as (
  select g, count(*) as leads,
    count(*) filter (where outcome='ganho') as ganho,
    count(*) filter (where outcome='perdido') as perdido
  from lg group by g
)
select a.g, a.leads::int, a.ganho::int, a.perdido::int,
  round(100.0*a.ganho/a.leads, 0) as pct_ganho,
  round(100.0*(select r from base_rate), 0) as base_ganho,
  round((a.ganho::numeric/nullif(a.leads,0)) / nullif((select r from base_rate),0), 2) as lift
from agg a
where a.leads >= p_min_support
  and ( (select r from base_rate) > 0
        and ( (a.ganho::numeric/a.leads) >= 3*(select r from base_rate) or a.ganho = 0 ) )
order by lift desc nulls last, a.leads desc;
$function$;

revoke all on function public.conv_ai_mine_candidates(uuid,int,text) from public;
grant execute on function public.conv_ai_mine_candidates(uuid,int,text) to service_role;
