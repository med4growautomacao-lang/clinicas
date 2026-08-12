-- 20260512172702_strip_used_tools_prefix_from_ai_messages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Função: remove o prefixo [Used tools: ...] respeitando colchetes aninhados.
-- Espelha a lógica de stripToolCallPrefix do frontend (contagem de depth).
CREATE OR REPLACE FUNCTION public.strip_used_tools_prefix(s text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  depth int := 0;
  i int;
  c char(1);
BEGIN
  IF s IS NULL OR position('[Used tools:' IN s) <> 1 THEN
    RETURN s;
  END IF;

  FOR i IN 1..length(s) LOOP
    c := substring(s FROM i FOR 1);
    IF c = '[' THEN
      depth := depth + 1;
    ELSIF c = ']' THEN
      depth := depth - 1;
      IF depth = 0 THEN
        RETURN ltrim(substring(s FROM i + 1));
      END IF;
    END IF;
  END LOOP;

  RETURN s;
END;
$$;

-- Trigger: limpa o content de mensagens AI no INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.fn_strip_tool_prefix_chat()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_content text;
  v_cleaned text;
BEGIN
  v_content := NEW.message->>'content';
  IF v_content IS NULL OR position('[Used tools:' IN v_content) <> 1 THEN
    RETURN NEW;
  END IF;

  v_cleaned := public.strip_used_tools_prefix(v_content);
  IF v_cleaned <> v_content THEN
    NEW.message := jsonb_set(NEW.message, '{content}', to_jsonb(v_cleaned));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS strip_tool_prefix_trg ON public.chat_messages;
CREATE TRIGGER strip_tool_prefix_trg
  BEFORE INSERT OR UPDATE ON public.chat_messages
  FOR EACH ROW
  WHEN (NEW.sender = 'ai')
  EXECUTE FUNCTION public.fn_strip_tool_prefix_chat();
