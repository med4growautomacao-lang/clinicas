-- 20260627050456_add_skip_ai_tool_traces_trigger
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_skip_ai_tool_traces()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
BEGIN
  -- Descarta os "traces" internos do agente LangChain (tool-calling v3) ANTES de gravar:
  --   - resultados de tool          -> message.type = 'tool'
  --   - chamadas de tool ("Calling X...") -> message.type = 'ai' com tool_calls nao-vazio
  -- Mantem Humano e a resposta final do AI (type='ai' sem tool_calls), preservando a
  -- sequencia valida pro LangChain e limpando painel + janela de memoria.
  IF jsonb_typeof(NEW.message) = 'object' THEN
    IF NEW.message->>'type' = 'tool' THEN
      RETURN NULL;
    END IF;
    IF NEW.message->>'type' = 'ai'
       AND jsonb_typeof(NEW.message->'tool_calls') = 'array'
       AND jsonb_array_length(NEW.message->'tool_calls') > 0 THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS tr_chat_message_a_skip_tool_traces ON public.chat_messages;
CREATE TRIGGER tr_chat_message_a_skip_tool_traces
BEFORE INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.fn_skip_ai_tool_traces();
