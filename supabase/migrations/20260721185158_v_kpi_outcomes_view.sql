-- 20260721185158_v_kpi_outcomes_view
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- v_kpi_outcomes — fonte única do eixo "Conversão" do Comercial. Mirror de
-- v_kpi_wins cobrindo os DOIS desfechos (ganho E perdido) com motivo de perda.
-- v_kpi_wins fica intocada (pg_depend: zero dependentes hoje).
create view public.v_kpi_outcomes
with (security_invoker = on) as
select
  t.id as ticket_id,
  t.lead_id,
  t.clinic_id,
  ((coalesce(t.outcome_at, t.closed_at)) at time zone 'America/Sao_Paulo')::date as day,
  t.outcome,
  t.loss_reason,
  case
    when l.source = 'meta_ads' then 'meta_ads'
    when l.source = 'google_ads' then 'google_ads'
    else 'no_track'
  end as platform,
  case
    when l.capture_channel = 'forms' then 'forms'
    when l.capture_channel = 'balcao' then 'balcao'
    else 'whatsapp'
  end as channel
from public.tickets t
join public.leads l on l.id = t.lead_id
where t.outcome in ('ganho', 'perdido')
  and coalesce(l.is_not_lead, false) = false;
