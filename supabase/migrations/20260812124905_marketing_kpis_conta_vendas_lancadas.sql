-- Marketing: nº de VENDAS LANÇADAS por dia × plataforma × canal.
--
-- A RPC já devolvia o VALOR (conv_value, de v_kpi_sales_value) e a contagem de CARDS ganhos
-- (wins, de v_kpi_wins). Faltava quantas vendas foram lançadas — número que passou a ser
-- diferente de "wins" desde que o mesmo card aceita mais de uma venda.
--
-- 📌 A contagem sai da MESMA CTE que já soma o valor (count(*) ao lado do sum), então recorte,
-- eixo de data (converted_at) e exclusão de 'Orçamento Enviado' são necessariamente os mesmos
-- do card de R$ que fica ao lado na tela.
--
-- ⚠️ DROP + CREATE, não CREATE OR REPLACE: a lista de colunas do RETURNS TABLE mudou, e o
-- Postgres recusa replace nesse caso. Como DROP+CREATE devolve EXECUTE ao PUBLIC por padrão,
-- os grants voltam explícitos no fim (CLAUDE.md §1: revogar de anon não fecha o grant de PUBLIC).
drop function if exists public.marketing_kpis(uuid, date, date);
drop function if exists public.marketing_kpis_impl(uuid, date, date);

create function public.marketing_kpis_impl(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, sales bigint, wins bigint, scheduled bigint)
language sql
stable
set search_path to 'public'
as $function$
  with
  lx as (select day, platform, channel, count(*)::bigint n from public.v_kpi_leads
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  wx as (select day, platform, channel, count(*)::bigint n from public.v_kpi_wins
         where clinic_id=p_clinic_id and day between p_start and p_end group by 1,2,3),
  -- sum = valor lançado; count = quantas vendas. Uma CTE só, de propósito.
  sx as (select day, platform, channel, sum(value)::numeric v, count(*)::bigint n from public.v_kpi_sales_value
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
         coalesce(sx.n,0) as sales,
         coalesce(wx.n,0) as wins,
         coalesce(gx.n,0) as scheduled
  from keys k
  left join lx on lx.day=k.day and lx.platform=k.platform and lx.channel=k.channel
  left join wx on wx.day=k.day and wx.platform=k.platform and wx.channel=k.channel
  left join sx on sx.day=k.day and sx.platform=k.platform and sx.channel=k.channel
  left join gx on gx.day=k.day and gx.platform=k.platform and gx.channel=k.channel;
$function$;

create function public.marketing_kpis(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric, sales bigint, wins bigint, scheduled bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_kpis_impl(p_clinic_id, p_start, p_end);
end;
$function$;

revoke all on function public.marketing_kpis_impl(uuid, date, date) from public, anon, authenticated;
revoke all on function public.marketing_kpis(uuid, date, date) from public, anon, authenticated;
grant execute on function public.marketing_kpis_impl(uuid, date, date) to service_role;
grant execute on function public.marketing_kpis(uuid, date, date) to authenticated, service_role;
