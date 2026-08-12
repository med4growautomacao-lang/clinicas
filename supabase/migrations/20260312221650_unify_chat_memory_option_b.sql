-- 20260312221650_unify_chat_memory_option_b
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Tornar clinic_id opcional para permitir inserção direta do n8n
ALTER TABLE public.chat_messages ALTER COLUMN clinic_id DROP NOT NULL;

-- 2. Remover a tabela redundante do n8n (o n8n passará a usar a chat_messages diretamente)
DROP TABLE IF EXISTS public.n8n_historico_mensagens;

-- 3. Função Unificada e Inteligente de Mensagens
CREATE OR REPLACE FUNCTION public.handle_chat_message_logic()
RETURNS TRIGGER AS $$
DECLARE
    json_data JSONB;
    v_ai_enabled boolean;
    v_global_active boolean;
    v_ref_clinic_id UUID;
    v_ref_lead_id UUID;
BEGIN
    -- A. LIMPEZA DE JSON (Lógica Blackback)
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

        -- B. DESCOBERTA DE VÍNCULOS (n8n Support)
        -- Se clinic_id ou lead_id estiverem vazios, tentamos descobrir via session_id
        IF (NEW.clinic_id IS NULL OR NEW.lead_id IS NULL) AND NEW.session_id IS NOT NULL THEN
            SELECT clinic_id, lead_id INTO v_ref_clinic_id, v_ref_lead_id
            FROM public.chat_messages
            WHERE session_id = NEW.session_id
              AND clinic_id IS NOT NULL 
              AND lead_id IS NOT NULL
            LIMIT 1;

            NEW.clinic_id := COALESCE(NEW.clinic_id, v_ref_clinic_id);
            NEW.lead_id := COALESCE(NEW.lead_id, v_ref_lead_id);
        END IF;

        -- C. MAPEAMENTO DE SENDER/DIRECTION (Auto-detect)
        IF (NEW.sender IS NULL) THEN
            DECLARE
                msg_role TEXT := COALESCE(json_data->>'role', json_data->>'type');
            BEGIN
                IF (msg_role = 'user' OR msg_role = 'human') THEN
                    NEW.sender := 'human';
                    -- Se vem do usuário via n8n/webhook, geralmente é inbound
                    IF NEW.direction IS NULL THEN NEW.direction := 'inbound'; END IF;
                ELSIF (msg_role IN ('ai', 'assistant', 'bot')) THEN
                    NEW.sender := 'ai';
                    IF NEW.direction IS NULL THEN NEW.direction := 'outbound'; END IF;
                END IF;
            END;
        END IF;
    END IF;

    -- D. CONTROLE DE TRANSBORDO E MASTER SWITCH
    IF NEW.sender = 'ai' AND NEW.clinic_id IS NOT NULL THEN
        -- Verifica o Master Switch Global
        SELECT auto_schedule INTO v_global_active 
        FROM public.ai_config 
        WHERE clinic_id = NEW.clinic_id;

        -- Se global estiver OFF, marcamos como bloqueado
        IF v_global_active = false THEN
            NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('ai_blocked', true, 'block_reason', 'global_off');
        END IF;

        -- Verifica o Switch por Lead
        IF NEW.lead_id IS NOT NULL THEN
            SELECT ai_enabled INTO v_ai_enabled 
            FROM public.leads 
            WHERE id = NEW.lead_id;

            IF v_ai_enabled = false THEN
                NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('ai_blocked', true, 'block_reason', 'handoff_active');
            END IF;
        END IF;
    END IF;

    -- E. AUTO-HANDOFF (Humano responde diretamente -> pausa IA)
    IF NEW.sender = 'human' AND NEW.direction = 'outbound' AND NEW.lead_id IS NOT NULL THEN
        UPDATE public.leads SET ai_enabled = false WHERE id = NEW.lead_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
