-- Corrige o salvamento do prefixo "[Used tools: ...]" na memoria do agente IA.
--
-- Sintoma: mensagens sender='ai' eram gravadas em chat_messages.message com o content
-- poluido por um bloco "[Used tools: Tool: NOME, Input: {}, Result: <JSON>] <fala real>".
-- A memoria do n8n (Postgres Chat Memory) rele esse content cru a cada rodada -> polui o
-- contexto, gasta tokens e faz a IA "lembrar" de resultados de tools antigos.
--
-- Causa raiz: ja existia o trigger strip_tool_prefix_trg + as funcoes fn_strip_tool_prefix_chat()
-- e strip_used_tools_prefix() (ambas corretas), mas o trigger NUNCA disparava nos inserts do n8n:
--   1. Triggers BEFORE disparam em ordem alfabetica do nome.
--      strip_tool_prefix_trg ('s') rodava ANTES de tr_chat_message_master_logic ('t').
--   2. O n8n insere a linha com sender NULL/'system'. Quem define NEW.sender='ai' e justamente
--      o handle_chat_message_master_logic().
--   3. Como strip_tool_prefix_trg rodava primeiro com WHEN (new.sender='ai'), a condicao era
--      avaliada quando sender ainda era NULL/'system' -> falsa -> o strip era pulado.
--
-- Correcao: reusa as funcoes existentes. Recria o trigger com nome que ordena DEPOIS de
-- tr_chat_message_master_logic (que ja normaliza message->object) e troca a condicao para
-- depender do CONTENT, nao do sender.

-- 1) Remove o trigger mal-ordenado/condicionado
DROP TRIGGER IF EXISTS strip_tool_prefix_trg ON public.chat_messages;

-- 2) Limpeza retroativa das mensagens ja salvas (107 no momento do diagnostico).
--    Feita com o trigger de strip inativo; a propria expressao faz a limpeza.
UPDATE public.chat_messages
SET message = jsonb_set(message, '{content}',
              to_jsonb(public.strip_used_tools_prefix(message->>'content')))
WHERE left(message->>'content', 12) = '[Used tools:'
  AND public.strip_used_tools_prefix(message->>'content') <> message->>'content';

-- 3) Recria o trigger com nome que ordena DEPOIS de tr_chat_message_master_logic.
--    A clausula WHEN e avaliada apos o master_logic ter rodado (message ja e objeto e o
--    prefixo, se houver, ja esta visivel) e nao depende mais do sender.
DROP TRIGGER IF EXISTS tr_chat_message_strip_tool_prefix ON public.chat_messages;
CREATE TRIGGER tr_chat_message_strip_tool_prefix
  BEFORE INSERT OR UPDATE ON public.chat_messages
  FOR EACH ROW
  WHEN (left(new.message->>'content', 12) = '[Used tools:')
  EXECUTE FUNCTION public.fn_strip_tool_prefix_chat();
