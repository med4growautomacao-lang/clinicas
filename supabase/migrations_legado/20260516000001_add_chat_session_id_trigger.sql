-- Preenche automaticamente chat_messages.session_id quando vier nulo.
-- session_id = telefone da clinica (whatsapp_instances) + telefone do lead.
-- Dispara BEFORE INSERT, apos tr_chat_message_master_logic (ordem alfabetica:
-- ..._master_logic < ..._session_id), entao lead_id/clinic_id ja estao resolvidos.
CREATE OR REPLACE FUNCTION public.fn_fill_chat_session_id()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_clinic_id    uuid;
  v_clinic_phone text;
  v_lead_phone   text;
BEGIN
  IF NEW.session_id IS NOT NULL AND NEW.session_id <> '' THEN
    RETURN NEW;
  END IF;

  v_clinic_id  := NEW.clinic_id;
  v_lead_phone := NEW.phone;

  IF NEW.lead_id IS NOT NULL THEN
    SELECT COALESCE(v_clinic_id, clinic_id),
           COALESCE(NULLIF(v_lead_phone, ''), phone)
      INTO v_clinic_id, v_lead_phone
      FROM public.leads
     WHERE id = NEW.lead_id;
  END IF;

  IF v_clinic_id IS NULL OR v_lead_phone IS NULL OR v_lead_phone = '' THEN
    RETURN NEW;
  END IF;

  SELECT phone_number INTO v_clinic_phone
    FROM public.whatsapp_instances
   WHERE clinic_id = v_clinic_id
     AND phone_number IS NOT NULL
     AND phone_number <> ''
   LIMIT 1;

  IF v_clinic_phone IS NOT NULL THEN
    NEW.session_id := v_clinic_phone || regexp_replace(v_lead_phone, '[^0-9]', '', 'g');
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_chat_message_session_id ON public.chat_messages;
CREATE TRIGGER tr_chat_message_session_id
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.fn_fill_chat_session_id();
