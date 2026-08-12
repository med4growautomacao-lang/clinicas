-- 20260609175552_tickets_lead_phone
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS lead_phone text;

UPDATE public.tickets t
SET lead_phone = l.phone
FROM public.leads l
WHERE l.id = t.lead_id
  AND t.lead_phone IS DISTINCT FROM l.phone;

CREATE OR REPLACE FUNCTION public.fn_set_ticket_lead_phone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.lead_phone IS NULL AND NEW.lead_id IS NOT NULL THEN
    SELECT phone INTO NEW.lead_phone FROM leads WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_ticket_lead_phone ON public.tickets;
CREATE TRIGGER trg_set_ticket_lead_phone
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_ticket_lead_phone();

CREATE INDEX IF NOT EXISTS tickets_lead_phone_idx ON public.tickets(lead_phone);
