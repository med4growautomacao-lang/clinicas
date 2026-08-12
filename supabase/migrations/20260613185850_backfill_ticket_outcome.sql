-- 20260613185850_backfill_ticket_outcome
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

WITH terminal AS (
  SELECT t.id AS ticket_id,
         fs.slug,
         COALESCE(
           t.outcome_at,
           t.closed_at,
           (SELECT MAX(h.changed_at) FROM lead_stage_history h
             WHERE h.ticket_id = t.id AND h.new_stage_id = t.stage_id),
           t.created_at
         ) AS resolved_at
  FROM tickets t
  JOIN funnel_stages fs ON fs.id = t.stage_id
  WHERE fs.slug IN ('ganho', 'perdido')
    AND t.outcome IS DISTINCT FROM fs.slug
)
UPDATE tickets t
SET outcome = term.slug,
    outcome_at = term.resolved_at
FROM terminal term
WHERE t.id = term.ticket_id;
