-- Backfill (one-time): alinha tickets.outcome ao ESTÁGIO terminal (ganho/perdido).
-- Raiz do problema: arrastar o card para "Ganho"/"Perdido" no Kanban grava só stage_id,
-- deixando outcome nulo/divergente. Resultado: ~220 em 'ganho' e ~189 em 'perdido' sem outcome.
-- A partir daqui, tickets.outcome é a fonte única da verdade de "ganhou/perdeu".
--
-- Preserva o TEMPO histórico do outcome (quando entrou na etapa terminal), evitando jogar
-- todos para a data de hoje. Escopo: apenas slugs 'ganho' e 'perdido' (faltou_cancelou fica fora).
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

-- Direção 2 (outcome -> estágio): tickets já com outcome mas fora da etapa terminal correspondente.
-- ganho -> etapa 'ganho'. perdido -> etapa 'perdido' (a menos que já esteja em 'faltou_cancelou',
-- que também representa perdido e é coluna própria). Só move se a clínica tiver a etapa.
UPDATE tickets t
SET stage_id = fs.id
FROM funnel_stages fs
WHERE fs.clinic_id = t.clinic_id AND fs.slug = 'ganho'
  AND t.outcome = 'ganho'
  AND t.stage_id IS DISTINCT FROM fs.id;

UPDATE tickets t
SET stage_id = fs.id
FROM funnel_stages fs
WHERE fs.clinic_id = t.clinic_id AND fs.slug = 'perdido'
  AND t.outcome = 'perdido'
  AND t.stage_id IS DISTINCT FROM fs.id
  AND t.stage_id NOT IN (
    SELECT id FROM funnel_stages
    WHERE clinic_id = t.clinic_id AND slug IN ('perdido', 'faltou_cancelou')
  );
