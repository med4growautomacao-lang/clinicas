-- 20260721143940_marketing_campaign_investment_rpc
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Investimento × Leads × Desfecho, por CAMPANHA. Arquitetura ANTI-FAN-OUT: spend e
-- leads/outcomes são agregados em CTEs SEPARADAS (1 linha por campanha em cada lado)
-- ANTES do join — um JOIN direto spend×leads seguido de SUM multiplicaria o investimento
-- pelo nº de leads casados (achado real na validação manual desta feature).
--
-- Eixo de data: leads por created_at (mesmo eixo de v_kpi_leads); investimento por
-- date (dia de veiculação). Ganho/Perdido = outcome ATUAL do ticket dos leads que
-- ENTRARAM no período (semântica de COORTE — leads recentes podem converter depois;
-- é o mesmo padrão de marketing_funnel_cohort/get_commercial_dashboard).
-- Plataforma: meta_ads/google_ads via l.source, mesmo mapeamento usado no resto do sistema.
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
    coalesce(s.investment, 0) as investment,
    coalesce(la.leads, 0) as leads,
    coalesce(la.wins, 0) as wins,
    coalesce(la.losses, 0) as losses,
    case when coalesce(la.leads, 0) > 0 then round(coalesce(s.investment, 0) / la.leads, 2) end as cpl,
    case when coalesce(la.wins, 0) > 0 then round(coalesce(s.investment, 0) / la.wins, 2) end as cac
  from spend s
  full outer join leads_agg la on la.campaign_name = s.campaign_name and la.platform = s.platform
  order by coalesce(s.investment, 0) desc;
$function$;

revoke all on function public.marketing_campaign_investment(uuid, date, date) from public;
grant execute on function public.marketing_campaign_investment(uuid, date, date) to authenticated;
