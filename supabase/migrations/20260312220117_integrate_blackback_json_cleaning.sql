-- 20260312220117_integrate_blackback_json_cleaning
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Função unificada para limpeza de JSON e Controle de Transbordo (Handoff)
CREATE OR REPLACE FUNCTION public.handle_chat_message_logic()
RETURNS TRIGGER AS $$
DECLARE
    json_data JSONB;
    v_ai_enabled boolean;
    v_global_active boolean;
BEGIN
    -- 1. LIMPEZA DE JSON (Lógica Blackback)
    -- Se o n8n enviar como string, limpamos e convertemos para objeto
    IF (NEW.message IS NOT NULL) THEN
        IF jsonb_typeof(NEW.message) = 'string' THEN
            BEGIN
                json_data := (NEW.message#>>'{}')::jsonb;
                NEW.message := json_data;
            EXCEPTION WHEN OTHERS THEN
                json_data := NEW.message;
            END;
        ELSE
            json_data := NEW.message;
        END IF;

        -- Sincronizar sender/role do JSON para a coluna da tabela se estiver vazio
        IF (NEW.sender IS NULL) THEN
            DECLARE
                msg_type TEXT := COALESCE(json_data->>'role', json_data->>'type');
            BEGIN
                IF (msg_type = 'human' OR msg_type = 'user') THEN
                    NEW.sender := 'human';
                ELSIF (msg_type IN ('ai', 'assistant', 'bot')) THEN
                    NEW.sender := 'ai';
                END IF;
            END;
        END IF;
    END IF;

    -- 2. CONTROLE DE TRANSBORDO E MASTER SWITCH
    -- Se as mensagens forem enviadas pela IA (sender = 'ai')
    IF NEW.sender = 'ai' AND NEW.lead_id IS NOT NULL THEN
        -- Verifica o Master Switch Global (ai_config.auto_schedule)
        SELECT auto_schedule INTO v_global_active 
        FROM public.ai_config 
    WHERE clinic_id = NEW.clinic_id;

    -- Verifica o Switch por Lead (leads.ai_enabled - Handoff)
    SELECT ai_enabled INTO v_ai_enabled 
    FROM public.leads 
    WHERE id = NEW.lead_id;

    -- Se global estiver OFF ou Handoff ativo, marcamos como bloqueado (auditável)
    -- O n8n deve checar esses flags antes de enviar para o WhatsApp
    IF v_global_active = false OR v_ai_enabled = false THEN
      -- Adicionamos uma flag no metadado para auditoria
      NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('ai_blocked', true);
    END IF;
  END IF;

  -- 3. AUTO-HANDOFF (Humano responde -> IA pausa)
  IF NEW.sender = 'human' AND NEW.direction = 'outbound' AND NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads SET ai_enabled = false WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-vincular o trigger único (limpar triggers antigos se existirem)
DROP TRIGGER IF EXISTS tr_block_ai_when_disabled ON public.chat_messages;
DROP TRIGGER IF EXISTS tr_chat_message_logic ON public.chat_messages;

CREATE TRIGGER tr_chat_message_logic
BEFORE INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_chat_message_logic();
