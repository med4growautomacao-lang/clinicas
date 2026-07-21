-- v_kpi_outcomes — fonte única do eixo "Conversão" do Comercial (Fase 1 do
-- plano de redefinição dos 3 calendários). Mirror de v_kpi_wins, mas cobrindo
-- os DOIS desfechos (ganho E perdido) na mesma view, com motivo de perda —
-- é o que o toggle Ganho/Perdido/Ambos do get_commercial_dashboard vai ler.
--
-- v_kpi_wins fica intocada (checado via pg_depend: zero views/funções
-- dependentes hoje; get_dashboard_stats/marketing_kpis recalculam outcome_at
-- inline, não usam a view) — esta é aditiva, sem risco de regressão.
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
