-- 20260721144055_marketing_campaign_investment_null_fix
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Fix: investment=0 estava sendo devolvido tanto p/ "gasto zero de verdade" quanto p/
-- "sem sincronização de investimento nesse período" (a MAIORIA dos casos, já que a
-- captura por campanha é nova) — o 2º caso mostrava CPL/CAC = R$0,00, insinuando "leads
-- de graça" quando na verdade é ausência de dado. investment agora fica NULL nesse caso
-- (sem coalesce a 0); CPL/CAC só calculam quando HÁ investimento sincronizado.
create or replace function public.marketing_campaign_investment(
  p_clinic_id uuid, p_start date, p_end date
)
returns table(
  campaign_name text,
  platform text,
  investment numeric,
  leads bigint,
  wins bigint,
  losses bigint,
  cpl numeric,
  cac numeric
)
language sql
stable
set search_path to 'public'
as $function$
  with spend as (
    select
      case when b.platform = 'meta_ads' then 'meta_ads' else 'google_ads' end as platform,
      b.campaign_name,
      sum(b.investment) as investment
    from public.marketing_spend_breakdown b
    where b.clinic_id = p_clinic_id
      and b.date between p_start and p_end
      and b.campaign_name <> ''
    group by 1, 2
  ),
  leads_agg as (
    select
      case when l.source = 'meta_ads' then 'meta_ads' when l.source = 'google_ads' then 'google_ads' else null end as platform,
      coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) as campaign_name,
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
    group by 1, 2
  )
  select
    coalesce(s.campaign_name, la.campaign_name) as campaign_name,
    coalesce(s.platform, la.platform) as platform,
    s.investment as investment,
    coalesce(la.leads, 0) as leads,
    coalesce(la.wins, 0) as wins,
    coalesce(la.losses, 0) as losses,
    case when s.investment is not null and coalesce(la.leads, 0) > 0 then round(s.investment / la.leads, 2) end as cpl,
    case when s.investment is not null and coalesce(la.wins, 0) > 0 then round(s.investment / la.wins, 2) end as cac
  from spend s
  full outer join leads_agg la on la.campaign_name = s.campaign_name and la.platform = s.platform
  order by s.investment desc nulls last;
$function$;
