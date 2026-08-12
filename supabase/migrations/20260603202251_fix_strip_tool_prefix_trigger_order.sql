-- 20260603202251_fix_strip_tool_prefix_trigger_order
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Corrige o salvamento do prefixo "[Used tools: ...]" na memoria do agente IA.
-- Causa: strip_tool_prefix_trg ('s') rodava ANTES de tr_chat_message_master_logic ('t'),
-- que e quem define NEW.sender='ai'. Com WHEN (new.sender='ai'), a condicao era falsa no
-- INSERT do n8n (sender ainda NULL/'system') e o strip nunca rodava.

-- 1) Remove o trigger mal-ordenado/condicionado
DROP TRIGGER IF EXISTS strip_tool_prefix_trg ON public.chat_messages;

-- 2) Limpeza retroativa das mensagens ja salvas (com o trigger de strip inativo)
UPDATE public.chat_messages
SET message = jsonb_set(message, '{content}',
              to_jsonb(public.strip_used_tools_prefix(message->>'content')))
WHERE left(message->>'content', 12) = '[Used tools:'
  AND public.strip_used_tools_prefix(message->>'content') <> message->>'content';

-- 3) Recria o trigger com nome que ordena DEPOIS de tr_chat_message_master_logic,
--    dependendo do CONTENT (nao do sender).
DROP TRIGGER IF EXISTS tr_chat_message_strip_tool_prefix ON public.chat_messages;
CREATE TRIGGER tr_chat_message_strip_tool_prefix
  BEFORE INSERT OR UPDATE ON public.chat_messages
  FOR EACH ROW
  WHEN (left(new.message->>'content', 12) = '[Used tools:')
  EXECUTE FUNCTION public.fn_strip_tool_prefix_chat();
