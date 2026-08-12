-- 20260714161554_protocolo_deixa_de_casar_por_substring
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Ver supabase/migrations/20260714000012_protocolo_deixa_de_casar_por_substring.sql
-- O protocolo casava por SUBSTRING no NOME do lead e grudava a conversa em quem não devia.
-- Medido: 3.250 msgs com protocolo · 619 (19%) no lead ERRADO · 124 leads contaminados.
-- 3 travas: phone IS NULL (placeholder nunca tem telefone; lead real sempre tem — 0 exceções),
-- protocolo >= 4 dígitos casando como TOKEN (não substring), e TTL + ORDER BY + LIMIT 1.
-- TTL em America/Sao_Paulo DE PROPÓSITO: leads.created_at é timestamp SEM tz com esse default;
-- usar now() puro embutiria 3h de desvio e o matcher pararia de casar em silêncio.

CREATE OR REPLACE FUNCTION public.handle_chat_message_master_logic()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    json_data JSONB;
    v_ref_clinic_id UUID;
    v_ref_lead_id UUID;
    v_lead_phone TEXT;
    v_clinic_phone TEXT;
    v_msg_content TEXT;
    v_protocol_match TEXT;
BEGIN
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

    IF NEW.clinic_id IS NULL AND NEW.session_id IS NOT NULL THEN
        SELECT clinic_id INTO v_ref_clinic_id FROM public.whatsapp_instances WHERE starts_with(NEW.session_id, phone_number) LIMIT 1;
        NEW.clinic_id := v_ref_clinic_id;
    END IF;

    IF NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
        v_lead_phone := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
    ELSE
        IF NEW.session_id IS NOT NULL AND v_lead_phone IS NULL THEN
            SELECT phone_number INTO v_clinic_phone FROM public.whatsapp_instances WHERE clinic_id = NEW.clinic_id LIMIT 1;
            IF v_clinic_phone IS NOT NULL AND starts_with(NEW.session_id, v_clinic_phone) THEN
                v_lead_phone := substr(NEW.session_id, length(v_clinic_phone) + 1);
            ELSE
                v_lead_phone := NEW.session_id;
            END IF;
        END IF;
    END IF;

    v_msg_content := json_data->>'content';
    IF v_msg_content IS NOT NULL AND v_msg_content ILIKE '%protocolo%' THEN
        v_protocol_match := (regexp_matches(v_msg_content, 'protocolo:?\s*([0-9]{4,})', 'i'))[1];

        IF v_protocol_match IS NOT NULL THEN
            SELECT id INTO v_ref_lead_id
            FROM public.leads
            WHERE clinic_id = NEW.clinic_id
              AND (phone IS NULL OR phone = '')
              AND name ILIKE '%pendente%'
              AND name ~ ('(^|\D)' || v_protocol_match || '(\D|$)')
              AND created_at > (now() AT TIME ZONE 'America/Sao_Paulo') - interval '7 days'
            ORDER BY created_at DESC
            LIMIT 1;
        END IF;
    END IF;

    IF v_ref_lead_id IS NULL AND v_lead_phone IS NOT NULL AND NEW.clinic_id IS NOT NULL THEN
        SELECT id INTO v_ref_lead_id FROM public.leads
        WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = normalize_br_phone(v_lead_phone) LIMIT 1;
    END IF;

    IF v_ref_lead_id IS NULL AND v_lead_phone IS NOT NULL AND NEW.clinic_id IS NOT NULL THEN
        INSERT INTO public.leads (clinic_id, name, phone, capture_channel, session_id)
        VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp', NEW.session_id)
        RETURNING id INTO v_ref_lead_id;
        IF v_ref_lead_id IS NULL THEN
            SELECT id INTO v_ref_lead_id FROM public.leads
            WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = normalize_br_phone(v_lead_phone) LIMIT 1;
        END IF;
    END IF;

    IF v_ref_lead_id IS NOT NULL AND NEW.session_id IS NOT NULL THEN
        UPDATE public.leads
        SET session_id = NEW.session_id
        WHERE id = v_ref_lead_id AND session_id IS DISTINCT FROM NEW.session_id;
    END IF;

    NEW.lead_id := v_ref_lead_id;
    NEW.phone := v_lead_phone;

    RETURN NEW;
END;
$function$;
