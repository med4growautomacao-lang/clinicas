-- 20260717162801_chat_messages_idempotency
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS wa_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_wa_message_id
  ON public.chat_messages (clinic_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_dedup_chat_message()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.wa_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE clinic_id = NEW.clinic_id
      AND wa_message_id = NEW.wa_message_id
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_chat_message_aa_dedup ON public.chat_messages;
CREATE TRIGGER tr_chat_message_aa_dedup
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_dedup_chat_message();
