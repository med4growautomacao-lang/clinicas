-- 20260312220855_n8n_native_memory_and_sync
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Criar a tabela de histórico padrão do n8n
CREATE TABLE IF NOT EXISTS public.n8n_historico_mensagens (
  id           BIGSERIAL PRIMARY KEY,
  session_id   VARCHAR(40) NOT NULL,
  message      JSONB NOT NULL,
  created_at   TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Função de Sincronização (n8n_historico_mensagens -> chat_messages)
CREATE OR REPLACE FUNCTION public.sync_n8n_memory_to_chat()
RETURNS TRIGGER AS $$
DECLARE
    v_clinic_id UUID;
    v_lead_id UUID;
    v_direction TEXT;
    v_sender TEXT;
    v_msg_role TEXT;
BEGIN
    -- Obter role da mensagem do n8n
    v_msg_role := NEW.message->>'role';
    
    -- Mapear direção e sender
    IF v_msg_role = 'user' THEN
        v_direction := 'inbound';
        v_sender := 'human';
    ELSE
        v_direction := 'outbound';
        v_sender := 'ai';
    END IF;

    -- Tentar encontrar clinic_id e lead_id baseando-se em mensagens anteriores com o mesmo session_id
    -- Isso garante que as mensagens do n8n caiam no lugar certo
    SELECT clinic_id, lead_id INTO v_clinic_id, v_lead_id
    FROM public.chat_messages
    WHERE session_id = NEW.session_id
    LIMIT 1;

    -- Se encontramos o vínculo, inserimos na chat_messages
    IF v_clinic_id IS NOT NULL AND v_lead_id IS NOT NULL THEN
        INSERT INTO public.chat_messages (
            clinic_id,
            lead_id,
            session_id,
            direction,
            sender,
            message,
            created_at
        ) VALUES (
            v_clinic_id,
            v_lead_id,
            NEW.session_id,
            v_direction,
            v_sender,
            NEW.message,
            NEW.created_at
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Criar o trigger de sincronização
DROP TRIGGER IF EXISTS tr_sync_n8n_memory ON public.n8n_historico_mensagens;
CREATE TRIGGER tr_sync_n8n_memory
AFTER INSERT ON public.n8n_historico_mensagens
FOR EACH ROW
EXECUTE FUNCTION public.sync_n8n_memory_to_chat();
