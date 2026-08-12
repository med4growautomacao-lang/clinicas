-- 20260312222006_consolidate_chat_logic_and_fix_resolution
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Remover todos os gatilhos antigos da chat_messages para evitar conflitos de ordem
DROP TRIGGER IF EXISTS tr_chat_message_logic ON public.chat_messages;
DROP TRIGGER IF EXISTS tr_chat_message_lead_capture ON public.chat_messages;
DROP TRIGGER IF EXISTS tr_block_ai_when_disabled ON public.chat_messages;

-- 2. Criar a FUNÇÃO MESTRE unificada
CREATE OR REPLACE FUNCTION public.handle_chat_message_master_logic()
RETURNS TRIGGER AS $$
DECLARE
    json_data JSONB;
    v_ai_enabled boolean;
    v_global_active boolean;
    v_ref_clinic_id UUID;
    v_ref_lead_id UUID;
    v_lead_phone TEXT;
    v_clinic_phone TEXT;
BEGIN
    -- [A] LIMPEZA E FORMATAÇÃO DE JSON (n8n Support)
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

        -- Detectar sender/role do JSON se estiver vazio
        IF (NEW.sender IS NULL) THEN
            DECLARE
                msg_role TEXT := COALESCE(json_data->>'role', json_data->>'type');
            BEGIN
                IF (msg_role = 'user' OR msg_role = 'human') THEN
                    NEW.sender := 'human';
                    IF NEW.direction IS NULL THEN NEW.direction := 'inbound'; END IF;
                ELSIF (msg_role IN ('ai', 'assistant', 'bot')) THEN
                    NEW.sender := 'ai';
                    IF NEW.direction IS NULL THEN NEW.direction := 'outbound'; END IF;
                END IF;
            END;
        END IF;
    END IF;

    -- [B] DESCOBERTA DE CLÍNICA (O Coração do Fix)
    -- Se não vier clinic_id (n8n), tentamos descobrir via session_id
    IF NEW.clinic_id IS NULL AND NEW.session_id IS NOT NULL THEN
        -- 1. Busca por histórico de mensagens
        SELECT clinic_id INTO v_ref_clinic_id FROM public.chat_messages WHERE session_id = NEW.session_id AND clinic_id IS NOT NULL LIMIT 1;
        
        -- 2. Se não achou (primeira mensagem), busca por prefixo do WhatsApp Instance
        IF v_ref_clinic_id IS NULL THEN
            SELECT clinic_id INTO v_ref_clinic_id FROM public.whatsapp_instances WHERE starts_with(NEW.session_id, phone_number) LIMIT 1;
        END IF;
        
        NEW.clinic_id := v_ref_clinic_id;
    END IF;

    -- [C] CAPTURA/CRIAÇÃO DE LEAD
    IF NEW.clinic_id IS NOT NULL AND NEW.lead_id IS NULL THEN
        -- Tenta extrair telefone do lead do session_id (prefixo da clínica removido)
        SELECT phone_number INTO v_clinic_phone FROM public.whatsapp_instances WHERE clinic_id = NEW.clinic_id LIMIT 1;
        
        IF v_clinic_phone IS NOT NULL AND starts_with(NEW.session_id, v_clinic_phone) THEN
            v_lead_phone := substr(NEW.session_id, length(v_clinic_phone) + 1);
        ELSE
            -- Fallback: últimos 12 ou 13 dígitos
            v_lead_phone := right(NEW.session_id, 12);
        END IF;

        IF v_lead_phone IS NOT NULL AND v_lead_phone <> '' THEN
            -- Busca lead existente
            SELECT id INTO v_ref_lead_id FROM public.leads WHERE clinic_id = NEW.clinic_id AND phone = v_lead_phone LIMIT 1;

            -- Se não existe, cria (AGORA COM CLINIC_ID GARANTIDO)
            IF v_ref_lead_id IS NULL THEN
                INSERT INTO public.leads (clinic_id, name, phone, source)
                VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp')
                RETURNING id INTO v_ref_lead_id;
            END IF;
            
            NEW.lead_id := v_ref_lead_id;
            NEW.phone := v_lead_phone;
        END IF;
    END IF;

    -- [D] CONTROLE DE TRANSBORDO E MASTER SWITCH
    IF NEW.sender = 'ai' AND NEW.clinic_id IS NOT NULL THEN
        SELECT auto_schedule INTO v_global_active FROM public.ai_config WHERE clinic_id = NEW.clinic_id;
        
        IF v_global_active = false THEN
            NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('ai_blocked', true, 'block_reason', 'global_off');
        END IF;

        IF NEW.lead_id IS NOT NULL THEN
            SELECT ai_enabled INTO v_ai_enabled FROM public.leads WHERE id = NEW.lead_id;
            IF v_ai_enabled = false THEN
                NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object('ai_blocked', true, 'block_reason', 'handoff_active');
            END IF;
        END IF;
    END IF;

    -- [E] AUTO-PAUSE IA (Humano respondeu)
    IF NEW.sender = 'human' AND NEW.direction = 'outbound' AND NEW.lead_id IS NOT NULL THEN
        UPDATE public.leads SET ai_enabled = false WHERE id = NEW.lead_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Recriar Trigger MESTRE UNIFICADO
CREATE TRIGGER tr_chat_message_master_logic
BEFORE INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_chat_message_master_logic();
