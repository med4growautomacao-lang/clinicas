-- ============================================
-- Último contato do lead + SLA e expediente
-- ============================================

-- Coluna last_message_at em leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

COMMENT ON COLUMN public.leads.last_message_at IS 'Timestamp da última mensagem inbound do lead';

-- Trigger: atualiza last_message_at ao receber mensagem inbound
CREATE OR REPLACE FUNCTION public.fn_update_lead_last_message()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL AND NEW.direction = 'inbound' THEN
    UPDATE public.leads
      SET last_message_at = NEW.created_at
      WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_lead_last_message ON public.chat_messages;

CREATE TRIGGER trg_update_lead_last_message
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_lead_last_message();

-- SLA e horário de expediente em ai_config
ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS sla_minutes    int  NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT
    '{"start":"08:00","end":"18:00","days":[1,2,3,4,5]}'::jsonb;

COMMENT ON COLUMN public.ai_config.sla_minutes    IS 'Tempo máximo de resposta em minutos (SLA)';
COMMENT ON COLUMN public.ai_config.business_hours IS 'Horário de expediente: {"start":"HH:MM","end":"HH:MM","days":[0-6]}';
