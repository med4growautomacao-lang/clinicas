-- 20260312224837_restore_option_a_for_stability
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Restaurar restrição na tabela principal
ALTER TABLE public.chat_messages ALTER COLUMN clinic_id SET NOT NULL;

-- 2. Criar a tabela de histórico EXACTLY como o n8n espera (com BIGSERIAL)
CREATE TABLE IF NOT EXISTS public.n8n_historico_mensagens (
  id           BIGSERIAL PRIMARY KEY,
  session_id   VARCHAR(40) NOT NULL,
  message      JSONB NOT NULL,
  created_at   TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Função de Sincronização Inteligente (n8n -> chat_messages)
CREATE OR REPLACE FUNCTION public.sync_n8n_memory_to_chat()
RETURNS TRIGGER AS $$
DECLARE
    json_data JSONB;
    v_clinic_id UUID;
    v_lead_id UUID;
    v_direction TEXT;
    v_sender TEXT;
    v_msg_role TEXT;
    v_ai_enabled boolean;
    v_global_active boolean;
BEGIN
    -- [A] LIMPEZA DE JSON (Blackback style)
    IF jsonb_typeof(NEW.message) = 'string' THEN
        BEGIN
            json_data := (NEW.message#>>'{}')::jsonb;
        EXCEPTION WHEN OTHERS THEN
            json_data := NEW.message;
        END;
    ELSE
        json_data := NEW.message;
    END IF;

    -- [B] MAPEAMENTO DE SENDER/DIRECTION
    v_msg_role := COALESCE(json_data->>'role', json_data->>'type');
    IF v_msg_role IN ('user', 'human') THEN
        v_direction := 'inbound';
        v_sender := 'human';
    ELSE
        v_direction := 'outbound';
        v_sender := 'ai';
    END IF;

    -- [C] DESCOBERTA DE CLÍNICA E LEAD (Célebro das Mensagens)
    -- Tenta descobrir clinic_id via prefixo do session_id (número da clínica)
    SELECT clinic_id INTO v_clinic_id FROM public.whatsapp_instances WHERE starts_with(NEW.session_id, phone_number) LIMIT 1;

    -- Se não achou por prefixo, tenta por histórico
    IF v_clinic_id IS NULL THEN
        SELECT clinic_id INTO v_clinic_id FROM public.chat_messages WHERE session_id = NEW.session_id LIMIT 1;
    END IF;

    -- Se temos a clínica, buscamos ou criamos o lead
    IF v_clinic_id IS NOT NULL THEN
        -- Resolve lead_id (similar ao master logic anterior)
        DECLARE
            v_clinic_phone TEXT;
            v_lead_phone TEXT;
        BEGIN
            SELECT phone_number INTO v_clinic_phone FROM public.whatsapp_instances WHERE clinic_id = v_clinic_id LIMIT 1;
            IF v_clinic_phone IS NOT NULL AND starts_with(NEW.session_id, v_clinic_phone) THEN
                v_lead_phone := substr(NEW.session_id, length(v_clinic_phone) + 1);
            ELSE
                v_lead_phone := right(NEW.session_id, 12);
            END IF;

            SELECT id INTO v_lead_id FROM public.leads WHERE clinic_id = v_clinic_id AND phone = v_lead_phone LIMIT 1;

            IF v_lead_id IS NULL THEN
                INSERT INTO public.leads (clinic_id, name, phone, source)
                VALUES (v_clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp')
                RETURNING id INTO v_lead_id;
            END IF;
        END;

        -- [D] CONTROLE DE SEGURANÇA (AI Handoff / Global Switch)
        IF v_sender = 'ai' THEN
            SELECT auto_schedule INTO v_global_active FROM public.ai_config WHERE clinic_id = v_clinic_id;
            SELECT ai_enabled INTO v_ai_enabled FROM public.leads WHERE id = v_lead_id;

            -- Se global OFF ou Handoff ON, marcamos como bloqueado nos metadados
            IF v_global_active = false OR v_ai_enabled = false THEN
                json_data := json_data || jsonb_build_object('metadata', COALESCE(json_data->'metadata', '{}'::jsonb) || jsonb_build_object('ai_blocked', true));
            END IF;
        END IF;

        -- [E] AUTO-PAUSE IA (Humano respondeu)
        IF v_sender = 'human' AND v_direction = 'outbound' THEN
            UPDATE public.leads SET ai_enabled = false WHERE id = v_lead_id;
        END IF;

        -- [F] INSERIR NA TABELA PRINCIPAL (Visível no Dashboard)
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
            json_data,
            NEW.created_at
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Recriar Trigger de Sincronização
DROP TRIGGER IF EXISTS tr_sync_n8n_memory ON public.n8n_historico_mensagens;
CREATE TRIGGER tr_sync_n8n_memory
AFTER INSERT ON public.n8n_historico_mensagens
FOR EACH ROW
EXECUTE FUNCTION public.sync_n8n_memory_to_chat();

-- 5. Limpar o Gatilho Mestre (Master Logic) da tabela principal para não duplicar esforços
DROP TRIGGER IF EXISTS tr_chat_message_master_logic ON public.chat_messages;
DROP FUNCTION IF EXISTS public.handle_chat_message_master_logic();

-- Manter apenas o gatilho de limpeza para mensagens inseridas VIA DASHBOARD na tabela principal
CREATE OR REPLACE FUNCTION public.handle_manual_chat_logic()
RETURNS TRIGGER AS $$
BEGIN
    -- Se for humano respondendo pelo dashboard
    IF NEW.sender = 'human' AND NEW.direction = 'outbound' AND NEW.lead_id IS NOT NULL THEN
        UPDATE public.leads SET ai_enabled = false WHERE id = NEW.lead_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER tr_manual_chat_logic
BEFORE INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_manual_chat_logic();
