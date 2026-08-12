-- 20260317220947_fix_orphan_messages_link_to_lead
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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

        -- Detecta se a mensagem da IA é um handoff (transbordo)
        IF NEW.sender = 'ai' AND json_data IS NOT NULL THEN
            IF json_data->>'content' ILIKE '%transferir%atendente%'
               OR json_data->>'content' ILIKE '%gatilho:%'
               OR json_data->>'content' ILIKE '%handoff%' THEN
                v_is_handoff := true;
            END IF;
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

        -- [C2] FALLBACK: se session_id = clinic phone (sem lead phone extraível),
        -- busca o lead mais recente ativo desta clínica
        IF NEW.lead_id IS NULL AND NEW.clinic_id IS NOT NULL THEN
            SELECT id, phone INTO v_ref_lead_id, v_lead_phone 
            FROM public.leads 
            WHERE clinic_id = NEW.clinic_id 
              AND ai_enabled = false
            ORDER BY updated_at DESC 
            LIMIT 1;
            
            IF v_ref_lead_id IS NOT NULL THEN
                NEW.lead_id := v_ref_lead_id;
                NEW.phone := v_lead_phone;
            END IF;
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

    -- [E] AUTO-PAUSE IA, BUMP DO LEAD E SLA BREACH
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
