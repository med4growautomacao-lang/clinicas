-- Adiciona ticket_id ao histórico de etapas para permitir contagem POR CICLO (ticket),
-- não por lead. Sem isso era impossível deduplicar/contar entradas por ticket.
--
-- - Coluna ticket_id (FK tickets).
-- - Trigger fn_log_ticket_stage_change passa a gravar NEW.id (roda na tabela tickets).
-- - Backfill: associa cada linha antiga ao ticket cuja janela [opened_at, closed_at)
--   contém a entrada. changed_at é timestamp SEM tz (horário SP) -> converte explicitamente
--   para comparar com tickets (timestamptz). Cobertura ~98% (resto = histórico anterior
--   ao sistema de tickets, fica órfão e é ignorado pelo funil).

ALTER TABLE public.lead_stage_history
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_lead_stage_history_ticket_id ON public.lead_stage_history(ticket_id);

CREATE OR REPLACE FUNCTION public.fn_log_ticket_stage_change()
RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    INSERT INTO lead_stage_history (clinic_id, lead_id, ticket_id, old_stage_id, new_stage_id, changed_at)
    VALUES (NEW.clinic_id, NEW.lead_id, NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END,
            NEW.stage_id, now());
  END IF;
  RETURN NEW;
END;
$function$;

WITH matched AS (
  SELECT h.id AS hist_id, t.id AS tk_id,
         row_number() OVER (PARTITION BY h.id ORDER BY t.opened_at DESC) AS rn
  FROM lead_stage_history h
  JOIN tickets t ON t.lead_id = h.lead_id
    AND (h.changed_at AT TIME ZONE 'America/Sao_Paulo') >= t.opened_at
    AND (h.changed_at AT TIME ZONE 'America/Sao_Paulo') <  COALESCE(t.closed_at, 'infinity'::timestamptz)
  WHERE h.ticket_id IS NULL
)
UPDATE public.lead_stage_history h
SET ticket_id = m.tk_id
FROM matched m
WHERE h.id = m.hist_id AND m.rn = 1;
