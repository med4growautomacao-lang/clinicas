-- Rollback da 20260717000009_chat_messages_idempotency
DROP TRIGGER IF EXISTS tr_chat_message_aa_dedup ON public.chat_messages;
DROP FUNCTION IF EXISTS public.fn_dedup_chat_message();
DROP INDEX IF EXISTS public.uq_chat_messages_wa_message_id;
ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS wa_message_id;
