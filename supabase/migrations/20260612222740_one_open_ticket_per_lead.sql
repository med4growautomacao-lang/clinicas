-- 20260612222740_one_open_ticket_per_lead
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Invariante: no maximo 1 ticket ABERTO por lead. Saneia duplicatas e cria indice unico.
WITH ranked AS (
  SELECT t.id, t.lead_id,
    row_number() OVER (PARTITION BY t.lead_id ORDER BY
      (EXISTS (SELECT 1 FROM appointments a WHERE a.ticket_id=t.id AND a.date>=current_date AND a.status IN ('pendente','confirmado'))) DESC,
      t.opened_at DESC) AS rn
  FROM tickets t WHERE t.status='open' AND t.lead_id IS NOT NULL)
UPDATE tickets t SET status='closed', closed_at=now(),
  notes=COALESCE(t.notes||' | ','')||'saneamento 13/06: 2o ticket aberto do mesmo lead fechado (invariante 1-aberto-por-lead)'
FROM ranked r WHERE t.id=r.id AND r.rn>1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_one_open_per_lead
  ON public.tickets (lead_id) WHERE status='open' AND lead_id IS NOT NULL;
