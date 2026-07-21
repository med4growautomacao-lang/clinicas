-- Split de investimento por REDE (facebook/instagram/…) dentro de cada campanha. Puramente
-- do lado do GASTO — não junta com leads (o lead não registra em qual posicionamento/rede
-- a impressão que gerou o clique foi servida; essa granularidade só existe no Meta).
-- Só platform='meta_ads' tem essa dimensão (Google não retorna publisher_platform aqui).
-- (Aplicada em produção via MCP como 'marketing_campaign_platform_split_rpc'.)
create or replace function public.marketing_campaign_platform_split(
  p_clinic_id uuid, p_start date, p_end date
)
returns table(
  campaign_name text,
  ad_platform text,
  investment numeric
)
language sql
stable
set search_path to 'public'
as $function$
  select b.campaign_name, b.ad_platform, sum(b.investment) as investment
  from public.marketing_spend_breakdown b
  where b.clinic_id = p_clinic_id
    and b.date between p_start and p_end
    and b.platform = 'meta_ads'
    and b.campaign_name <> ''
    and b.ad_platform <> ''
  group by 1, 2
  order by 1, investment desc;
$function$;

revoke all on function public.marketing_campaign_platform_split(uuid, date, date) from public;
grant execute on function public.marketing_campaign_platform_split(uuid, date, date) to authenticated;
