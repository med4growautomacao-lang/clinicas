-- 20260724195651_20260724165609_fix_marketing_campaign_investment_name_normalization
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- marketing_campaign_investment: casa gasto(Meta) x leads(CRM) por NOME NORMALIZADO.
-- Motivo: a ingestão suja o nome (espaço duplicado; emoji corrompido, ex.: 💲 -> "?"), o que
-- antes rachava a MESMA campanha/conjunto/anúncio em 2 linhas (uma só com gasto, outra só com
-- leads) e parecia duplicação no painel de Marketing. A chave de join vira alnum minúsculo
-- (regexp_replace [^[:alnum:]]), aplicada IGUAL nos dois lados. O RÓTULO exibido é canônico por
-- chave (first_value preferindo o lado com investimento = nome do Meta, com emoji intacto), pra
-- UI (que agrupa por nome) fundir sem duplicar. NÃO resolve nome genuinamente diferente entre
-- lead e Meta (lead não guarda fb_*_id) — isso exige capturar o ID na ingestão (fix estrutural).
CREATE OR REPLACE FUNCTION public.marketing_campaign_investment(p_clinic_id uuid, p_start date, p_end date)
 RETURNS TABLE(campaign_name text, adset_name text, ad_name text, platform text, investment numeric, leads bigint, wins bigint, losses bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with spend as (
    select
      case when b.platform = 'meta_ads' then 'meta_ads' else 'google_ads' end as platform,
      lower(regexp_replace(b.campaign_name, '[^[:alnum:]]+', '', 'g')) as k_campaign,
      lower(regexp_replace(coalesce(nullif(b.adset_name, ''), ''), '[^[:alnum:]]+', '', 'g')) as k_adset,
      lower(regexp_replace(coalesce(nullif(b.ad_name, ''), ''), '[^[:alnum:]]+', '', 'g')) as k_ad,
      max(b.campaign_name) as campaign_name,
      max(nullif(b.adset_name, '')) as adset_name,
      max(nullif(b.ad_name, '')) as ad_name,
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
      lower(regexp_replace(coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')), '[^[:alnum:]]+', '', 'g')) as k_campaign,
      lower(regexp_replace(coalesce(nullif(l.fb_adset_name, ''), nullif(l.g_adset_name, ''), ''), '[^[:alnum:]]+', '', 'g')) as k_adset,
      lower(regexp_replace(coalesce(nullif(l.fb_ad_name, ''), nullif(l.g_ad_name, ''), ''), '[^[:alnum:]]+', '', 'g')) as k_ad,
      max(coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, ''))) as campaign_name,
      max(coalesce(nullif(l.fb_adset_name, ''), nullif(l.g_adset_name, ''))) as adset_name,
      max(coalesce(nullif(l.fb_ad_name, ''), nullif(l.g_ad_name, ''))) as ad_name,
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
  ),
  joined as (
    select
      coalesce(s.platform, la.platform) as platform,
      coalesce(s.k_campaign, la.k_campaign) as k_campaign,
      coalesce(s.k_adset, la.k_adset) as k_adset,
      coalesce(s.k_ad, la.k_ad) as k_ad,
      coalesce(s.campaign_name, la.campaign_name) as campaign_name,
      coalesce(s.adset_name, la.adset_name) as adset_name,
      coalesce(s.ad_name, la.ad_name) as ad_name,
      s.investment,
      coalesce(la.leads, 0) as leads,
      coalesce(la.wins, 0) as wins,
      coalesce(la.losses, 0) as losses
    from spend s
    full outer join leads_agg la
      on la.platform = s.platform
     and la.k_campaign = s.k_campaign
     and la.k_adset is not distinct from s.k_adset
     and la.k_ad is not distinct from s.k_ad
  )
  select
    first_value(campaign_name) over (
      partition by platform, k_campaign
      order by (investment is not null) desc, campaign_name
    ) as campaign_name,
    first_value(adset_name) over (
      partition by platform, k_campaign, k_adset
      order by (investment is not null) desc, adset_name
    ) as adset_name,
    first_value(ad_name) over (
      partition by platform, k_campaign, k_adset, k_ad
      order by (investment is not null) desc, ad_name
    ) as ad_name,
    platform,
    investment,
    leads,
    wins,
    losses
  from joined
  order by investment desc nulls last;
$function$;
