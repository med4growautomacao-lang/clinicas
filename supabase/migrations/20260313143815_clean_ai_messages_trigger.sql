-- 20260313143815_clean_ai_messages_trigger
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Function to clean up technical jargon and format nested JSON in chat_messages
CREATE OR REPLACE FUNCTION public.fn_clean_chat_message()
RETURNS TRIGGER AS $$
DECLARE
    raw_message TEXT;
    cleaned_message TEXT;
    final_json JSONB;
BEGIN
    -- Only act on AI messages
    IF NEW.sender <> 'ai' THEN
        RETURN NEW;
    END IF;

    -- Extract text from various possible JSONB formats
    IF jsonb_typeof(NEW.message) = 'array' THEN
        -- If it's an array [ {"output": "..."} ], take first element
        NEW.message := NEW.message->0;
    END IF;

    -- Get the main text content
    raw_message := COALESCE(
        NEW.message->>'content',
        NEW.message->>'output',
        NEW.message->>'text',
        NEW.message->>'message',
        NEW.message::text
    );

    -- 1. Remove [Used tools: ...] blocks (Regex supported in PL/pgSQL via regexp_replace)
    -- We use 'g' flag for global replacement
    cleaned_message := regexp_replace(raw_message, '\[Used tools:[\s\S]*?\]', '', 'g');

    -- 2. Basic Trim
    cleaned_message := trim(cleaned_message);

    -- 3. Re-structure as a clean object { "role": "assistant", "content": "..." }
    NEW.message := jsonb_build_object(
        'role', 'assistant',
        'content', cleaned_message
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists and recreate trigger
DROP TRIGGER IF EXISTS tr_clean_chat_message ON public.chat_messages;
CREATE TRIGGER tr_clean_chat_message
BEFORE INSERT OR UPDATE ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.fn_clean_chat_message();
