-- 20260718195651_canonical_kpi_views
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Views canônicas de KPI: definem CADA conceito uma vez, para os 3 painéis lerem a
-- MESMA fonte. security_invoker=on é OBRIGATÓRIO — sem isso a view roda como owner
-- e fura a RLS multi-tenant (lição do is_admin()). Timezone documentado por coluna.
-- Atribuição IA×Humano NÃO entra aqui: exige varrer chat_messages por load (caro),
-- será precomputada em passo próprio. Rollback: DROP VIEW das 4.

-- Leads válidos (exclui is_not_lead). created_at é SP-naive → ::date direto.
create or replace view public.v_kpi_leads with (security_invoker = true) as
select
  l.id as lead_id, l.clinic_id, l.created_at::date as day,
  case when l.source='meta_ads' then 'meta_ads' when l.source='google_ads' then 'google_ads' else 'no_track' end as platform,
  case when l.capture_channel='forms' then 'forms' when l.capture_channel='balcao' then 'balcao' else 'whatsapp' end as channel
from public.leads l
where coalesce(l.is_not_lead,false)=false;

-- Vendas = tickets.outcome='ganho' (fonte única da verdade). Data = COALESCE(outcome_at,
-- closed_at) convertida de timestamptz p/ SP. 1 linha por ticket ganho.
create or replace view public.v_kpi_wins with (security_invoker = true) as
select
  t.id as ticket_id, t.lead_id, t.clinic_id,
  (coalesce(t.outcome_at, t.closed_at) at time zone 'America/Sao_Paulo')::date as day,
  case when l.source='meta_ads' then 'meta_ads' when l.source='google_ads' then 'google_ads' else 'no_track' end as platform,
  case when l.capture_channel='forms' then 'forms' when l.capture_channel='balcao' then 'balcao' else 'whatsapp' end as channel
from public.tickets t
join public.leads l on l.id=t.lead_id
where t.outcome='ganho' and coalesce(l.is_not_lead,false)=false;

-- Valor lançado (faturamento) = conversions, excluindo 'Orçamento Enviado'. Data =
-- converted_at (timestamptz) convertida p/ SP. Lead deletado → no_track (mantém no total).
create or replace view public.v_kpi_sales_value with (security_invoker = true) as
select
  c.clinic_id, c.ticket_id, c.lead_id,
  (c.converted_at at time zone 'America/Sao_Paulo')::date as day,
  coalesce(c.value,0) as value,
  case when l.source='meta_ads' then 'meta_ads' when l.source='google_ads' then 'google_ads' else 'no_track' end as platform,
  case when l.capture_channel='forms' then 'forms' when l.capture_channel='balcao' then 'balcao' else 'whatsapp' end as channel
from public.conversions c
left join public.leads l on l.id=c.lead_id
where c.description is distinct from 'Orçamento Enviado'
  and (l.id is null or coalesce(l.is_not_lead,false)=false);

-- Agendado = ticket com consulta na agenda OU que entrou na etapa 'agendado', 1× por
-- ticket (união deduplicada). day = data em que virou agendado (LEAST ignora NULL).
-- appointments.created_at e lead_stage_history.changed_at são SP-naive → ::date direto.
create or replace view public.v_kpi_scheduled with (security_invoker = true) as
with appt as (
  select a.ticket_id, min(a.created_at::date) as appt_day,
         bool_or(a.status in ('realizado','compareceu')) as realized
  from public.appointments a where a.ticket_id is not null group by a.ticket_id
),
stg as (
  select h.ticket_id, min(h.changed_at::date) as stage_day
  from public.lead_stage_history h
  join public.funnel_stages fs on fs.id=h.new_stage_id
  where fs.slug='agendado' and h.ticket_id is not null group by h.ticket_id
)
select
  t.id as ticket_id, t.lead_id, t.clinic_id,
  least(appt.appt_day, stg.stage_day) as day,
  case when l.source='meta_ads' then 'meta_ads' when l.source='google_ads' then 'google_ads' else 'no_track' end as platform,
  case when l.capture_channel='forms' then 'forms' when l.capture_channel='balcao' then 'balcao' else 'whatsapp' end as channel,
  (appt.ticket_id is not null) as has_appointment,
  (appt.ticket_id is null and stg.ticket_id is not null) as stage_only,
  coalesce(appt.realized,false) as realized
from public.tickets t
join public.leads l on l.id=t.lead_id
left join appt on appt.ticket_id=t.id
left join stg on stg.ticket_id=t.id
where (appt.ticket_id is not null or stg.ticket_id is not null)
  and coalesce(l.is_not_lead,false)=false;
