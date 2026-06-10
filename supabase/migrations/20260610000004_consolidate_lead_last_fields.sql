-- Dois ajustes da auditoria (10/06/2026):
--
-- 1) Guard em sync_clinic_name_to_instance: só escreve em whatsapp_instances
--    quando o nome realmente mudou (mesmo padrão de sync_clinic_name_to_chat_messages).
--
-- 2) Consolida os 3 triggers AFTER INSERT em chat_messages que faziam 3 UPDATEs
--    separados em leads (last_activity_at / last_message_at / last_outbound_at)
--    num único trigger + UPDATE. Comportamento idêntico:
--      - last_activity_at: sempre (qualquer direção)
--      - last_message_at:  só inbound
--      - last_outbound_at: só outbound

-- (1) -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_clinic_name_to_instance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE whatsapp_instances
    SET clinic_name = NEW.name
    WHERE clinic_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- (2) -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_update_lead_last_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
      SET last_activity_at = NEW.created_at,
          last_message_at  = CASE WHEN NEW.direction = 'inbound'  THEN NEW.created_at ELSE last_message_at  END,
          last_outbound_at = CASE WHEN NEW.direction = 'outbound' THEN NEW.created_at ELSE last_outbound_at END
      WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_lead_last_activity ON public.chat_messages;
DROP TRIGGER IF EXISTS trg_update_lead_last_message  ON public.chat_messages;
DROP TRIGGER IF EXISTS trg_update_lead_last_outbound ON public.chat_messages;

CREATE TRIGGER trg_update_lead_last_fields
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION fn_update_lead_last_fields();

DROP FUNCTION IF EXISTS public.fn_update_lead_last_activity();
DROP FUNCTION IF EXISTS public.fn_update_lead_last_message();
DROP FUNCTION IF EXISTS public.fn_update_lead_last_outbound();
