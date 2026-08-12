-- 20260403023227_update_chat_trigger_to_handle_pending_leads_smartly
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Reativa a trigger de chat que eu tinha parado para testar
ALTER TABLE chat_messages ENABLE TRIGGER tr_chat_message_master_logic;

-- 2. Atualiza a função master para ser inteligente com "Lead Pendente"
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
    v_existing_name TEXT;
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

    -- [C] CAPTURA/CRIAÇÃO DE LEAD (INTELIGENTE COM PENDENTES)
    IF NEW.clinic_id IS NOT NULL AND (NEW.lead_id IS NULL OR NEW.phone IS NULL) THEN
        SELECT phone_number INTO v_clinic_phone FROM public.whatsapp_instances WHERE clinic_id = NEW.clinic_id LIMIT 1;

        v_lead_phone := NEW.phone;

        IF (v_lead_phone IS NULL OR v_lead_phone = '') AND NEW.session_id IS NOT NULL THEN
            IF v_clinic_phone IS NOT NULL
               AND starts_with(NEW.session_id, v_clinic_phone)
               AND length(NEW.session_id) > length(v_clinic_phone) THEN
                v_lead_phone := substr(NEW.session_id, length(v_clinic_phone) + 1);
            ELSIF NEW.session_id <> COALESCE(v_clinic_phone, '') THEN
                v_lead_phone := NEW.session_id;
            END IF;
        END IF;

        IF v_lead_phone IS NOT NULL AND v_lead_phone <> '' AND v_lead_phone <> COALESCE(v_clinic_phone, '') THEN
            -- BUSCA SE JÁ EXISTE UM LEAD (PENDENTE OU NÃO)
            SELECT id, name INTO v_ref_lead_id, v_existing_name 
            FROM public.leads 
            WHERE clinic_id = NEW.clinic_id AND phone = v_lead_phone 
            LIMIT 1;
            
            -- DEFINIÇÃO DA ETAPA PADRÃO
            SELECT id INTO v_stage_id 
            FROM public.funnel_stages 
            WHERE clinic_id = NEW.clinic_id 
              AND LOWER(name) ILIKE '%contato%whatsapp%'
            LIMIT 1;

            IF v_stage_id IS NULL THEN
                SELECT id INTO v_stage_id FROM public.funnel_stages 
                WHERE clinic_id = NEW.clinic_id 
                  AND (LOWER(name) LIKE '%whatsapp%' OR LOWER(name) LIKE '%contato%')
                ORDER BY position ASC LIMIT 1;
            END IF;

            IF v_stage_id IS NULL THEN
                SELECT id INTO v_stage_id FROM public.funnel_stages 
                WHERE clinic_id = NEW.clinic_id 
                ORDER BY position ASC LIMIT 1;
            END IF;

            IF v_ref_lead_id IS NOT NULL THEN
                -- SE FOR PENDENTE OU SE VIER SEM NOME REAL, ATUALIZAMOS O NOME
                IF v_existing_name ILIKE '%Pendente%' OR v_existing_name IS NULL OR v_existing_name = 'Lead ' || v_lead_phone THEN
                    UPDATE public.leads 
                    SET name = 'Lead ' || v_lead_phone,
                        capture_channel = COALESCE(capture_channel, 'whatsapp'),
                        updated_at = now()
                    WHERE id = v_ref_lead_id;
                END IF;
            ELSE
                -- CRIA O LEAD DO ZERO SE NÃO ENCONTRAR NADA
                INSERT INTO public.leads (clinic_id, name, phone, capture_channel, stage_id)
                VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp', v_stage_id)
                RETURNING id INTO v_ref_lead_id;
            END IF;

            NEW.lead_id := COALESCE(NEW.lead_id, v_ref_lead_id);
            NEW.phone := COALESCE(NEW.phone, v_lead_phone);
        END IF;
    END IF;

    -- [D] LÓGICA DE AUTOMAÇÃO/TRANSBORDO/TROCA DE ETAPA (SIMPLIFICADO PARA TESTE)
    IF NEW.direction IS NULL THEN NEW.direction := 'outbound'; END IF;
    IF NEW.lead_id IS NOT NULL THEN
        UPDATE public.leads SET updated_at = now() WHERE id = NEW.lead_id;
    END IF;

    RETURN NEW;
END;
$function$;
