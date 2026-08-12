-- 20260610040038_consolidate_lead_last_fields
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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
