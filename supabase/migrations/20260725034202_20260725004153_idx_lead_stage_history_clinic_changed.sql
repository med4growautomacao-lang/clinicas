-- 20260725034202_20260725004153_idx_lead_stage_history_clinic_changed
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- lead_stage_history só tinha índice de lead_id/ticket_id/pkey — nenhum de clinic_id, embora
-- TODA consulta de painel filtre por clínica (marketing_utm_funnel_cohort, marketing_funnel_cohort,
-- funil por ticket). Resultado: seq scan na tabela inteira a cada chamada.
-- Agrava porque o front pagina a RPC via .range(): cada página RE-EXECUTA a função inteira, então
-- o custo do scan é multiplicado pelo nº de páginas (é o que produz o
-- "canceling statement due to statement timeout" sob carga — 100 ocorrências desde 18/07).
create index if not exists idx_lead_stage_history_clinic_changed
  on public.lead_stage_history (clinic_id, changed_at);
