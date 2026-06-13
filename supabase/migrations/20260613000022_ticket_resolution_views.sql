-- View canônica de resolução do ticket (referência única para auditoria/relatórios).
-- result = derivado de tickets.outcome (fonte única). is_resolved = status='closed'.
-- security_invoker=true → respeita RLS de tickets (isolamento por clínica).
CREATE OR REPLACE VIEW public.v_ticket_resolution
WITH (security_invoker = true) AS
SELECT
  t.id          AS ticket_id,
  t.clinic_id,
  t.lead_id,
  t.stage_id,
  fs.slug       AS stage_slug,
  t.status,
  t.outcome,
  t.outcome_at,
  CASE
    WHEN t.outcome = 'ganho'   THEN 'ganho'
    WHEN t.outcome = 'perdido' THEN 'perdido'
    ELSE 'aberto'
  END           AS result,
  (t.status = 'closed') AS is_resolved,
  EXISTS (SELECT 1 FROM appointments a WHERE a.ticket_id = t.id AND a.status IN ('realizado', 'compareceu')) AS has_realizado,
  EXISTS (SELECT 1 FROM conversions c WHERE c.ticket_id = t.id AND c.value::numeric > 0) AS has_conversion_value
FROM tickets t
LEFT JOIN funnel_stages fs ON fs.id = t.stage_id;

-- View de integridade: lista clínicas com divergências estágio×outcome remanescentes (deve ficar vazia).
CREATE OR REPLACE VIEW public.vw_funnel_integrity
WITH (security_invoker = true) AS
SELECT
  t.clinic_id,
  c.name AS clinic_name,
  COUNT(*) FILTER (WHERE fs.slug = 'ganho'   AND t.outcome IS DISTINCT FROM 'ganho')   AS ganho_stage_sem_outcome,
  COUNT(*) FILTER (WHERE fs.slug = 'perdido' AND t.outcome IS DISTINCT FROM 'perdido') AS perdido_stage_sem_outcome,
  COUNT(*) FILTER (WHERE t.outcome = 'ganho' AND fs.slug <> 'ganho')                   AS ganho_outcome_fora_estagio,
  COUNT(*) FILTER (WHERE t.status = 'closed' AND t.outcome IS NULL)                    AS closed_sem_outcome
FROM tickets t
LEFT JOIN funnel_stages fs ON fs.id = t.stage_id
LEFT JOIN clinics c ON c.id = t.clinic_id
GROUP BY t.clinic_id, c.name
HAVING COUNT(*) FILTER (WHERE fs.slug = 'ganho'   AND t.outcome IS DISTINCT FROM 'ganho')   > 0
    OR COUNT(*) FILTER (WHERE fs.slug = 'perdido' AND t.outcome IS DISTINCT FROM 'perdido') > 0
    OR COUNT(*) FILTER (WHERE t.outcome = 'ganho' AND fs.slug <> 'ganho')                   > 0;
