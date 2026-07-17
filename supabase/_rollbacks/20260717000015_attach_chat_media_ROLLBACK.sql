-- Rollback da 20260717000015_attach_chat_media
-- (a edge wa-inbound passa a logar erro ao tentar anexar; mídia volta a ficar
-- só como placeholder textual — mensagens não se perdem)
DROP FUNCTION IF EXISTS public.attach_chat_media(uuid, text, text, text, text, numeric);
