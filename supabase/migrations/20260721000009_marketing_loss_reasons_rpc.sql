-- Perdas por MOTIVO × campanha — mesma arquitetura das outras RPCs de investimento
-- (coorte de entrada: leads que ENTRARAM na janela; outcome ATUAL do ticket).
-- tickets.loss_reason já existe e alimenta o Kanban/UTM×Etapa local — isto vira eixo GLOBAL.
-- Investimento é o TOTAL da campanha (repetido em cada linha de motivo, não rateado por
-- motivo — ratear por motivo seria uma estimativa em cima de outra estimativa; melhor
-- mostrar o número real da campanha e deixar quem lê comparar com a contagem de perdidos).
-- Validado (Intubação): soma dos motivos por campanha bate EXATO com campaign_losses em
-- 100% das campanhas (nenhum fan-out). (Aplicada via MCP como 'marketing_loss_reasons_rpc'.)
create or replace function public.marketing_loss_reasons(
  p_clinic_id uuid, p_start date, p_end date
)
returns table(
  campaign_name text,
  platform text,
  loss_reason text,
  losses bigint,
  campaign_investment numeric,
  campaign_leads bigint,
  campaign_losses bigint
)
language sql
stable
set search_path to 'public'
as $function$
  with campaign_spend as (
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
  campaign_totals as (
    select
      case when l.source = 'meta_ads' then 'meta_ads' when l.source = 'google_ads' then 'google_ads' else null end as platform,
      coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) as campaign_name,
      count(*) as leads,
      count(*) filter (where t.outcome = 'perdido') as losses
    from public.leads l
    left join public.tickets t on t.lead_id = l.id
    where l.clinic_id = p_clinic_id
      and l.created_at::date between p_start and p_end
      and coalesce(l.is_not_lead, false) = false
      and coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) is not null
      and l.source in ('meta_ads', 'google_ads')
    group by 1, 2
  ),
  loss_reasons as (
    select
      case when l.source = 'meta_ads' then 'meta_ads' when l.source = 'google_ads' then 'google_ads' else null end as platform,
      coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) as campaign_name,
      coalesce(nullif(t.loss_reason, ''), '(sem motivo registrado)') as loss_reason,
      count(*) as losses
    from public.leads l
    join public.tickets t on t.lead_id = l.id
    where l.clinic_id = p_clinic_id
      and l.created_at::date between p_start and p_end
      and coalesce(l.is_not_lead, false) = false
      and coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) is not null
      and l.source in ('meta_ads', 'google_ads')
      and t.outcome = 'perdido'
    group by 1, 2, 3
  )
  select
    r.campaign_name,
    r.platform,
    r.loss_reason,
    r.losses,
    cs.investment as campaign_investment,
    coalesce(ct.leads, 0) as campaign_leads,
    coalesce(ct.losses, 0) as campaign_losses
  from loss_reasons r
  left join campaign_spend cs on cs.campaign_name = r.campaign_name and cs.platform = r.platform
  left join campaign_totals ct on ct.campaign_name = r.campaign_name and ct.platform = r.platform
  order by r.losses desc;
$function$;

revoke all on function public.marketing_loss_reasons(uuid, date, date) from public;
grant execute on function public.marketing_loss_reasons(uuid, date, date) to authenticated;
