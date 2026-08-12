-- 20260718200851_marketing_kpis_v2_wins_scheduled
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- marketing_kpis v2: além de leads e conv_value, agrega wins (tickets.outcome='ganho')
-- e scheduled (união agendamento∪etapa) das views canônicas, por dia×plataforma×canal.
-- Cards Conversões/Agendamentos do Marketing passam a usar a MESMA fonte que VG/Comercial.
-- Drop+create numa transação (aditivo: front atual segue lendo leads/conv_value).
drop function if exists public.marketing_kpis(uuid, date, date);

create function public.marketing_kpis(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, wins bigint, scheduled bigint)
language sql
stable
set search_path to 'public'
as $function$
  with
  lx as (select day, platform, channel, count(*)::bigint n from public.v_kpi_leads
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  wx as (select day, platform, channel, count(*)::bigint n from public.v_kpi_wins
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  sx as (select day, platform, channel, sum(value)::numeric v from public.v_kpi_sales_value
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  gx as (select day, platform, channel, count(*)::bigint n from public.v_kpi_scheduled
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  keys as (
    select day,platform,channel from lx
    union select day,platform,channel from wx
    union select day,platform,channel from sx
    union select day,platform,channel from gx
  )
  select k.day, k.platform, k.channel,
         coalesce(lx.n,0) as leads,
         coalesce(sx.v,0) as conv_value,
         coalesce(wx.n,0) as wins,
         coalesce(gx.n,0) as scheduled
  from keys k
  left join lx on lx.day=k.day and lx.platform=k.platform and lx.channel=k.channel
  left join wx on wx.day=k.day and wx.platform=k.platform and wx.channel=k.channel
  left join sx on sx.day=k.day and sx.platform=k.platform and sx.channel=k.channel
  left join gx on gx.day=k.day and gx.platform=k.platform and gx.channel=k.channel;
$function$;

revoke execute on function public.marketing_kpis(uuid, date, date) from anon;
