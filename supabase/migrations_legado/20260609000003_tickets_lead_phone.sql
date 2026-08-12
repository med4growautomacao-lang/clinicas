-- Adiciona tickets.lead_phone (telefone do lead, denormalizado) + backfill + trigger
-- que preenche automaticamente em QUALQUER caminho de criacao de ticket
-- (RPC create_lead_with_ticket, trigger fn_auto_open_ticket, inserts do app e do n8n).

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS lead_phone text;

-- Backfill dos tickets existentes a partir do lead.
UPDATE public.tickets t
SET lead_phone = l.phone
FROM public.leads l
WHERE l.id = t.lead_id
  AND t.lead_phone IS DISTINCT FROM l.phone;

-- Garante o preenchimento em TODA insercao de ticket, independente da origem.
-- So busca em leads quando lead_phone nao veio explicitamente no INSERT.
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
