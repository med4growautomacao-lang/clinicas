-- 20260403025650_chat_message_master_logic_v3_anti_leak_security_fix
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Aumentando a segurança contra "vazamento" de chat entre leads
CREATE OR REPLACE FUNCTION public.handle_chat_message_master_logic()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    json_data JSONB;
    v_ai_enabled boolean;
    v_global_active boolean;
    v_ref_clinic_id UUID;
    v_ref_lead_id UUID;
    v_lead_phone TEXT;
    v_clinic_phone TEXT;
    v_stage_id UUID;
    v_sla_minutes integer;
    v_business_hours jsonb;
    v_last_msg_at timestamptz;
    v_last_out_at timestamptz;
    v_is_handoff boolean := false;
    v_handoff_rules jsonb;
    v_transition_rules jsonb;
    v_rule jsonb;
    v_msg_content TEXT;
    v_keyword TEXT;
    v_protocol_uuid UUID;
    v_protocol_match TEXT;
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

    -- [B] DESCOBERTA DE CLÍNICA (REFORÇADA)
    IF NEW.clinic_id IS NULL AND NEW.session_id IS NOT NULL THEN
        SELECT clinic_id INTO v_ref_clinic_id FROM public.whatsapp_instances WHERE starts_with(NEW.session_id, phone_number) LIMIT 1;
        NEW.clinic_id := v_ref_clinic_id;
    END IF;

    -- [C] LÓGICA DE CAPTURA DO TELEFONE REAL (BLINDAGEM ANTI-CASCALHO)
    -- Se o telefone vier na mensagem (ex do Evolution API), ele é OBERANO contra o session_id
    IF NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
        v_lead_phone := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
    ELSE
        -- Fallback: extrair o phone do session_id apenas se necessário
        IF NEW.session_id IS NOT NULL AND v_lead_phone IS NULL THEN
            SELECT phone_number INTO v_clinic_phone FROM public.whatsapp_instances WHERE clinic_id = NEW.clinic_id LIMIT 1;
            IF v_clinic_phone IS NOT NULL AND starts_with(NEW.session_id, v_clinic_phone) THEN
                v_lead_phone := substr(NEW.session_id, length(v_clinic_phone) + 1);
            ELSE
                v_lead_phone := NEW.session_id;
            END IF;
        END IF;
    END IF;

    -- [D] BUSCA POR PROTOCOLO (SEGUNDA CAMADA DE SEGURANÇA)
    v_msg_content := json_data->>'content';
    IF v_msg_content IS NOT NULL AND v_msg_content ILIKE '%protocolo%' THEN
        v_protocol_match := (regexp_matches(v_msg_content, 'protocolo:?\s*(\w+)', 'i'))[1];
        IF v_protocol_match IS NOT NULL THEN
            SELECT id INTO v_ref_lead_id FROM public.leads 
            WHERE clinic_id = NEW.clinic_id 
              AND (name ILIKE ('%Lead pendente%' || v_protocol_match || '%') OR name ILIKE ('%' || v_protocol_match || '%'));
        END IF;
    END IF;

    -- [E] BUSCA FINAL (Se não achou protocolo, busca pelo telefone REAL e CLINICA)
    IF v_ref_lead_id IS NULL AND v_lead_phone IS NOT NULL THEN
        SELECT id INTO v_ref_lead_id FROM public.leads WHERE phone = v_lead_phone AND clinic_id = NEW.clinic_id LIMIT 1;
    END IF;

    -- [F] AMARRAÇÃO E CRIAÇÃO CASO NÃO EXISTA
    IF v_ref_lead_id IS NULL AND v_lead_phone IS NOT NULL AND NEW.clinic_id IS NOT NULL THEN
        -- Criação inteligente com capture_channel
        INSERT INTO public.leads (clinic_id, name, phone, capture_channel)
        VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp')
        RETURNING id INTO v_ref_lead_id;
    END IF;

    -- Configuração definitiva para a mensagem
    NEW.lead_id := v_ref_lead_id;
    NEW.phone := v_lead_phone;

    RETURN NEW;
END;
$function$;
