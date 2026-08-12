-- 20260312231656_update_leads_updated_at_on_new_message
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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
    -- [A] LIMPEZA E FORMATAÇÃO DE JSON
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

        IF NEW.sender IS NULL OR NEW.sender = 'system' THEN
            DECLARE
                msg_role TEXT := COALESCE(json_data->>'role', json_data->>'type');
            BEGIN
                IF (msg_role = 'user' OR msg_role = 'human') THEN
                    NEW.sender := 'human';
                    NEW.direction := 'inbound';
                ELSIF (msg_role IN ('ai', 'assistant', 'bot')) THEN
                    NEW.sender := 'ai';
                    NEW.direction := 'outbound';
                ELSE
                    NEW.sender := 'system';
                    NEW.direction := 'outbound';
                END IF;
            END;
        END IF;
    END IF;

    -- [B] DESCOBERTA DE CLÍNICA
    IF NEW.clinic_id IS NULL AND NEW.session_id IS NOT NULL THEN
        SELECT clinic_id INTO v_ref_clinic_id FROM public.chat_messages WHERE session_id = NEW.session_id AND clinic_id IS NOT NULL LIMIT 1;
        IF v_ref_clinic_id IS NULL THEN
            SELECT clinic_id INTO v_ref_clinic_id FROM public.whatsapp_instances WHERE starts_with(NEW.session_id, phone_number) LIMIT 1;
        END IF;
        NEW.clinic_id := v_ref_clinic_id;
    END IF;

    -- [C] CAPTURA/CRIAÇÃO DE LEAD
    IF NEW.clinic_id IS NOT NULL AND (NEW.lead_id IS NULL OR NEW.phone IS NULL) THEN
        SELECT phone_number INTO v_clinic_phone FROM public.whatsapp_instances WHERE clinic_id = NEW.clinic_id LIMIT 1;
        IF v_clinic_phone IS NOT NULL AND starts_with(NEW.session_id, v_clinic_phone) THEN
            v_lead_phone := substr(NEW.session_id, length(v_clinic_phone) + 1);
        ELSE
            v_lead_phone := right(NEW.session_id, 12);
        END IF;

        IF v_lead_phone IS NOT NULL AND v_lead_phone <> '' THEN
            SELECT id INTO v_ref_lead_id FROM public.leads WHERE clinic_id = NEW.clinic_id AND phone = v_lead_phone LIMIT 1;
            IF v_ref_lead_id IS NULL THEN
                INSERT INTO public.leads (clinic_id, name, phone, source)
                VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp')
                RETURNING id INTO v_ref_lead_id;
            END IF;
            NEW.lead_id := COALESCE(NEW.lead_id, v_ref_lead_id);
            NEW.phone := COALESCE(NEW.phone, v_lead_phone);
        END IF;
    END IF;

    IF NEW.direction IS NULL THEN
        NEW.direction := 'outbound';
    END IF;

    -- [D] CONTROLE DE TRANSBORDO
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

    -- [E] AUTO-PAUSE IA E BUMP DO LEAD (Mover para o topo na inbox)
    IF NEW.lead_id IS NOT NULL THEN
        IF NEW.sender = 'human' AND NEW.direction = 'outbound' THEN
            -- Se humano digitou, desliga a IA e atualiza o updated_at
            UPDATE public.leads SET ai_enabled = false, updated_at = now() WHERE id = NEW.lead_id;
        ELSE
            -- Para qualquer outra mensagem (lead mandou, ou IA respondeu), atualiza apenas o updated_at
            UPDATE public.leads SET updated_at = now() WHERE id = NEW.lead_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
