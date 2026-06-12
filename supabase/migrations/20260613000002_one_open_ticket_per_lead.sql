-- Invariante: no maximo 1 ticket ABERTO por lead.
-- Foi a falta dessa invariante que permitiu os casos Suelen/Luana (12/06): um 2o ticket
-- aberto do mesmo lead numa etapa reengajavel disparava reengajamento mesmo ja agendado.
--
-- 1) Saneamento (geral e idempotente): para cada lead com >1 ticket aberto, mantem o que
--    tem agendamento futuro ativo (senao o mais recente) e fecha os demais.
-- 2) Indice unico parcial que impede reincidencia. O helper fn_resolve_patient_lead_ticket
--    sempre REUSA o ticket aberto, entao nunca tenta abrir um 2o.

WITH ranked AS (
  SELECT t.id, t.lead_id,
         row_number() OVER (
           PARTITION BY t.lead_id
           ORDER BY
             (EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.ticket_id = t.id
                  AND a.date >= current_date
                  AND a.status IN ('pendente','confirmado')
             )) DESC,
             t.opened_at DESC
         ) AS rn
  FROM tickets t
  WHERE t.status = 'open' AND t.lead_id IS NOT NULL
)
UPDATE tickets t
   SET status = 'closed',
       closed_at = now(),
       notes = COALESCE(t.notes || ' | ', '') ||
               'saneamento 13/06: 2o ticket aberto do mesmo lead fechado (invariante 1-aberto-por-lead)'
FROM ranked r
WHERE t.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_one_open_per_lead
  ON public.tickets (lead_id)
  WHERE status = 'open' AND lead_id IS NOT NULL;
