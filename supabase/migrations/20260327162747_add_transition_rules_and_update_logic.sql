-- 20260327162747_add_transition_rules_and_update_logic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Add transition_rules column to ai_config
ALTER TABLE public.ai_config ADD COLUMN IF NOT EXISTS transition_rules jsonb DEFAULT '[]'::jsonb;

-- 2. Update handle_chat_message_master_logic to include new automation logic
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
    v_transition_rules jsonb; -- NEW
    v_rule jsonb;
    v_msg_content TEXT;
    v_keyword TEXT;
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
            SELECT id INTO v_ref_lead_id FROM public.leads WHERE clinic_id = NEW.clinic_id AND phone = v_lead_phone LIMIT 1;
            IF v_ref_lead_id IS NULL THEN
                SELECT id INTO v_stage_id FROM public.funnel_stages 
                WHERE clinic_id = NEW.clinic_id 
                ORDER BY position ASC LIMIT 1;

                -- Fallback para etapa WhatsApp
                SELECT id INTO v_stage_id FROM public.funnel_stages 
                WHERE clinic_id = NEW.clinic_id 
                  AND (LOWER(name) LIKE '%whatsapp%' OR LOWER(name) LIKE '%contato%')
                ORDER BY position ASC LIMIT 1;

                INSERT INTO public.leads (clinic_id, name, phone, source, stage_id)
                VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp', v_stage_id)
                RETURNING id INTO v_ref_lead_id;
            END IF;
            NEW.lead_id := COALESCE(NEW.lead_id, v_ref_lead_id);
            NEW.phone := COALESCE(NEW.phone, v_lead_phone);
        END IF;
    END IF;

    -- [D] LÓGICA DE AUTOMAÇÃO/TRANSBORDO/TROCA DE ETAPA
    IF NEW.clinic_id IS NOT NULL AND NEW.lead_id IS NOT NULL AND json_data IS NOT NULL THEN
        SELECT handoff_rules, transition_rules INTO v_handoff_rules, v_transition_rules 
        FROM public.ai_config WHERE clinic_id = NEW.clinic_id;
        
        v_msg_content := json_data->>'content';
        
        IF v_msg_content IS NOT NULL THEN
            -- [D.1] Regras de Transbordo (Handoff)
            IF v_handoff_rules IS NOT NULL THEN
                FOR v_rule IN SELECT * FROM jsonb_array_elements(v_handoff_rules)
                LOOP
                    FOR v_keyword IN SELECT trim(val) FROM unnest(string_to_array(v_rule->>'keywords', ',')) val
                    LOOP
                        IF v_keyword <> '' AND v_msg_content ILIKE '%' || v_keyword || '%' THEN
                            -- Aplica mudança de etapa se definida na regra de handoff
                            IF v_rule->>'move_to_stage' IS NOT NULL AND v_rule->>'move_to_stage' <> '' THEN
                                UPDATE public.leads SET stage_id = (v_rule->>'move_to_stage')::uuid, updated_at = now() WHERE id = NEW.lead_id;
                            END IF;
                            
                            -- Aplica ação de transbordo (pausa IA)
                            IF v_rule->>'action' IN ('notify_human', 'pause_ai') THEN
                                UPDATE public.leads SET ai_enabled = false, updated_at = now() WHERE id = NEW.lead_id;
                                v_is_handoff := true;
                            END IF;
                            EXIT; 
                        END IF;
                    END LOOP;
                END LOOP;
            END IF;

            -- [D.2] Regras de Troca de Etapa (Transition Rules) - NEW
            IF v_transition_rules IS NOT NULL THEN
                FOR v_rule IN SELECT * FROM jsonb_array_elements(v_transition_rules)
                LOOP
                    -- Keywords podem estar em v_rule->'keywords' como string ou v_rule->'phrases' como array/string
                    -- Conforme plano, vamos usar 'keywords' (vido que é o padrão já existente em handoff) ou explicitamente como o usuário configurar no modal.
                    -- No modal vamos salvar como 'keywords' (string) para manter consistência interna com o código do handoff.
                    FOR v_keyword IN SELECT trim(val) FROM unnest(string_to_array(v_rule->>'keywords', ',')) val
                    LOOP
                        IF v_keyword <> '' AND v_msg_content ILIKE '%' || v_keyword || '%' THEN
                            IF v_rule->>'target_stage_id' IS NOT NULL AND v_rule->>'target_stage_id' <> '' THEN
                                UPDATE public.leads 
                                SET stage_id = (v_rule->>'target_stage_id')::uuid,
                                    updated_at = now()
                                WHERE id = NEW.lead_id;
                            END IF;
                            EXIT; 
                        END IF;
                    END LOOP;
                END LOOP;
            END IF;
        END IF;
        
        -- Fallback para detecção legada
        IF NOT v_is_handoff AND NEW.sender = 'ai' THEN
            IF v_msg_content ILIKE '%transferir%atendente%'
               OR v_msg_content ILIKE '%gatilho:%'
               OR v_msg_content ILIKE '%handoff%' THEN
                v_is_handoff := true;
            END IF;
        END IF;
    END IF;

    -- [E] POS-PROCESSAMENTO (SLA, AI PAUSE, UPDATED_AT)
    IF NEW.direction IS NULL THEN
        NEW.direction := 'outbound';
    END IF;

    -- Bloqueio da IA por Transbordo ou Configuração Global
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

    -- Atualização de timestamps e SLA
    IF NEW.lead_id IS NOT NULL THEN
        IF NEW.sender = 'human' AND NEW.direction = 'outbound' THEN
            -- Atendente humano respondeu → pausa IA e marca outbound
            UPDATE public.leads SET ai_enabled = false, last_outbound_at = now(), updated_at = now() WHERE id = NEW.lead_id;
        ELSIF NEW.direction = 'outbound' THEN
            -- Resposta outbound (IA ou sistema)
            IF v_is_handoff THEN
                UPDATE public.leads SET ai_enabled = false, updated_at = now() WHERE id = NEW.lead_id;
            ELSE
                SELECT sla_minutes, business_hours INTO v_sla_minutes, v_business_hours
                FROM public.ai_config WHERE clinic_id = NEW.clinic_id;

                IF v_sla_minutes IS NOT NULL AND v_sla_minutes > 0 THEN
                    SELECT last_message_at, last_outbound_at 
                    INTO v_last_msg_at, v_last_out_at
                    FROM public.leads WHERE id = NEW.lead_id;

                    IF v_last_msg_at IS NOT NULL 
                       AND (v_last_out_at IS NULL OR v_last_msg_at > v_last_out_at)
                       AND (EXTRACT(EPOCH FROM (now() - v_last_msg_at)) / 60) > v_sla_minutes THEN
                        UPDATE public.leads 
                        SET sla_breach_count = sla_breach_count + 1, 
                            last_outbound_at = now(), 
                            updated_at = now() 
                        WHERE id = NEW.lead_id;
                    ELSE
                        UPDATE public.leads SET last_outbound_at = now(), updated_at = now() WHERE id = NEW.lead_id;
                    END IF;
                ELSE
                    UPDATE public.leads SET last_outbound_at = now(), updated_at = now() WHERE id = NEW.lead_id;
                END IF;
            END IF;
        ELSIF NEW.sender = 'human' AND NEW.direction = 'inbound' THEN
            UPDATE public.leads SET last_message_at = now(), updated_at = now() WHERE id = NEW.lead_id;
        ELSE
            UPDATE public.leads SET updated_at = now() WHERE id = NEW.lead_id;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;
