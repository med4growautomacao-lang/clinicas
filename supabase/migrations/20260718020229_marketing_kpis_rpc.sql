-- 20260718020229_marketing_kpis_rpc
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- KPIs do painel Marketing agregados no BANCO (leads criados + valor de conversões),
-- por dia × plataforma × canal. Substitui a contagem client-side sobre useLeads()/
-- useConversions(), que era clampada pelo max_rows do PostgREST (1000) e zerava os
-- cards em clínicas grandes (KPI "Leads"=0 com 39 leads reais no dia — 18/07/2026).
-- Semântica idêntica ao client + alinhada ao funil:
--   platform: leads.source ('meta_ads' | 'google_ads' | resto = 'no_track')
--   channel:  leads.capture_channel ('forms' | 'balcao' | resto = 'whatsapp')
--   exclui is_not_lead (igual marketing_funnel_cohort)
--   leads.created_at é SP-naive (::date direto); conversions.converted_at é timestamptz
--   (converter para America/Sao_Paulo antes do ::date)
--   conversões: exclui description 'Orçamento Enviado' (orçamento não é conversão)
create or replace function public.marketing_kpis(p_clinic_id uuid, p_start date, p_end date)
returns table(day date, platform text, channel text, leads bigint, conv_value numeric)
language sql
stable
set search_path to 'public'
as $function$
  with lx as (
    select l.created_at::date as day,
           case when l.source = 'meta_ads'   then 'meta_ads'
                when l.source = 'google_ads' then 'google_ads'
                else 'no_track' end as platform,
           case when l.capture_channel = 'forms'  then 'forms'
                when l.capture_channel = 'balcao' then 'balcao'
                else 'whatsapp' end as channel,
           count(*)::bigint as leads
    from leads l
    where l.clinic_id = p_clinic_id
      and coalesce(l.is_not_lead, false) = false
      and l.created_at::date between p_start and p_end
    group by 1, 2, 3
  ),
  cx as (
    select (cv.converted_at at time zone 'America/Sao_Paulo')::date as day,
           case when ld.source = 'meta_ads'   then 'meta_ads'
                when ld.source = 'google_ads' then 'google_ads'
                else 'no_track' end as platform,
           case when ld.capture_channel = 'forms'  then 'forms'
                when ld.capture_channel = 'balcao' then 'balcao'
                else 'whatsapp' end as channel,
           sum(cv.value)::numeric as conv_value
    from conversions cv
    left join leads ld on ld.id = cv.lead_id
    where cv.clinic_id = p_clinic_id
      and cv.description is distinct from 'Orçamento Enviado'
      and (cv.converted_at at time zone 'America/Sao_Paulo')::date between p_start and p_end
    group by 1, 2, 3
  )
  select coalesce(lx.day, cx.day)           as day,
         coalesce(lx.platform, cx.platform) as platform,
         coalesce(lx.channel, cx.channel)   as channel,
         coalesce(lx.leads, 0)              as leads,
         coalesce(cx.conv_value, 0)         as conv_value
  from lx
  full outer join cx on cx.day = lx.day and cx.platform = lx.platform and cx.channel = lx.channel;
$function$;

revoke execute on function public.marketing_kpis(uuid, date, date) from anon;
