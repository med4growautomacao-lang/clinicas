-- 20260609052731_lead_stage_history_ticket_id
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1) Coluna ticket_id no histórico de etapas (faltava: sem isso é impossível dedupe por ciclo).
ALTER TABLE public.lead_stage_history
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES public.tickets(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_lead_stage_history_ticket_id ON public.lead_stage_history(ticket_id);

-- 2) Trigger passa a gravar o ticket. Roda na tabela tickets, então NEW.id é o ticket.
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

-- 3) Backfill: associa cada linha antiga ao ticket cuja janela [opened_at, closed_at) contém a entrada.
--    changed_at é timestamp SEM tz (horário SP); converte explicitamente para comparar com tickets (timestamptz).
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
