-- ============================================
-- Último contato outbound do lead (sem resposta)
-- ============================================

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz;

COMMENT ON COLUMN public.leads.last_outbound_at IS 'Timestamp da última mensagem outbound enviada ao lead (sem resposta desde então)';

CREATE OR REPLACE FUNCTION public.fn_update_lead_last_outbound()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.direction = 'outbound' THEN
    UPDATE public.leads
      SET last_outbound_at = NEW.created_at
      WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_lead_last_outbound ON public.chat_messages;

CREATE TRIGGER trg_update_lead_last_outbound
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_lead_last_outbound();
