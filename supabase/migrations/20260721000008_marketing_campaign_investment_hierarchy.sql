-- Fase 2: desce a granularidade até ANÚNCIO (campanha → conjunto → anúncio). Muda o RETURN
-- TYPE (novas colunas adset_name/ad_name) então precisa DROP antes do CREATE.
--
-- Duas mudanças de arquitetura vs a v1 (migration 20260721000006):
-- (1) spend é agregado por NOME (não por id) em cada nível — leads só têm NOME (sem
--     campaign_id/adset_id/ad_id no registro), então juntar por id deixaria o lado do
--     spend "mais fino" que o join consegue casar; nomes duplicados entre campanhas
--     diferentes (ex.: "1 a 7", "POST01") já apareceram nos dados reais da Intubação.
-- (2) CPL/CAC SAÍRAM do RPC. Razão não é aditiva — somar CPL de N anúncios não dá o CPL
--     da campanha; o correto é somar investment/leads/wins e SÓ DEPOIS dividir. Como o
--     front precisa fazer isso em CADA nível do acordeão (campanha, conjunto E anúncio),
--     ficou mais simples ter UMA função só (no front) que soma os aditivos e calcula a
--     razão, em vez de duplicar a lógica em SQL para o nível-folha e em JS para os totais.
--
-- adset_name/ad_name = NULL quando a captura não desce até ali (Google só tem conjunto
-- nesta fase — ad_name sempre NULL do lado do gasto). Join NULL-safe (IS NOT DISTINCT
-- FROM) para não perder o casamento nesse caso. (Aplicada em produção via MCP como
-- 'marketing_campaign_investment_hierarchy'.)
drop function if exists public.marketing_campaign_investment(uuid, date, date);

create function public.marketing_campaign_investment(
  p_clinic_id uuid, p_start date, p_end date
)
returns table(
  campaign_name text,
  adset_name text,
  ad_name text,
  platform text,
  investment numeric,
  leads bigint,
  wins bigint,
  losses bigint
)
language sql
stable
set search_path to 'public'
as $function$
  with spend as (
    select
      case when b.platform = 'meta_ads' then 'meta_ads' else 'google_ads' end as platform,
      b.campaign_name,
      nullif(b.adset_name, '') as adset_name,
      nullif(b.ad_name, '') as ad_name,
      sum(b.investment) as investment
    from public.marketing_spend_breakdown b
    where b.clinic_id = p_clinic_id
      and b.date between p_start and p_end
      and b.campaign_name <> ''
    group by 1, 2, 3, 4
  ),
  leads_agg as (
    select
      case when l.source = 'meta_ads' then 'meta_ads' when l.source = 'google_ads' then 'google_ads' else null end as platform,
      coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) as campaign_name,
      coalesce(nullif(l.fb_adset_name, ''), nullif(l.g_adset_name, '')) as adset_name,
      coalesce(nullif(l.fb_ad_name, ''), nullif(l.g_ad_name, '')) as ad_name,
      count(*) as leads,
      count(*) filter (where t.outcome = 'ganho') as wins,
      count(*) filter (where t.outcome = 'perdido') as losses
    from public.leads l
    left join public.tickets t on t.lead_id = l.id
    where l.clinic_id = p_clinic_id
      and l.created_at::date between p_start and p_end
      and coalesce(l.is_not_lead, false) = false
      and coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) is not null
      and l.source in ('meta_ads', 'google_ads')
    group by 1, 2, 3, 4
  )
  select
    coalesce(s.campaign_name, la.campaign_name) as campaign_name,
    coalesce(s.adset_name, la.adset_name) as adset_name,
    coalesce(s.ad_name, la.ad_name) as ad_name,
    coalesce(s.platform, la.platform) as platform,
    s.investment,
    coalesce(la.leads, 0) as leads,
    coalesce(la.wins, 0) as wins,
    coalesce(la.losses, 0) as losses
  from spend s
  full outer join leads_agg la
    on la.campaign_name = s.campaign_name
   and la.platform = s.platform
   and la.adset_name is not distinct from s.adset_name
   and la.ad_name is not distinct from s.ad_name
  order by s.investment desc nulls last;
$function$;

revoke all on function public.marketing_campaign_investment(uuid, date, date) from public;
grant execute on function public.marketing_campaign_investment(uuid, date, date) to authenticated;
