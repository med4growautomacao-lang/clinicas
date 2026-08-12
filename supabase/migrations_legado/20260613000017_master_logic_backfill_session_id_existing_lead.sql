-- BUG: leads que entram por 'forms'/'app' nascem SEM session_id. Quando a conversa de
-- WhatsApp comeca, handle_chat_message_master_logic acha o lead ja existente pelo telefone
-- (secao [E]) e amarra a mensagem, mas so gravava session_id no caminho de INSERT (secao [F]).
-- Resultado: o lead fica com session_id NULL para sempre e o n8n quebra no
-- "UPDATE leads ... WHERE session_id = ..." (0 linhas -> "row you are trying to update doesn't exist").
--
-- Fix: nova secao [G] faz backfill do session_id no lead existente quando ele esta NULL.
-- So preenche quando NULL (o mesmo session_id pode aparecer em varios leads da mesma pessoa,
-- entao nao sobrescrevemos um valor ja gravado). Corpo da funcao = versao live (com a busca
-- por telefone NORMALIZADO e o fallback pos-INSERT).

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
    -- [A] LIMPEZA E FORMATACAO DE JSON
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

    -- [B] DESCOBERTA DE CLINICA
    IF NEW.clinic_id IS NULL AND NEW.session_id IS NOT NULL THEN
        SELECT clinic_id INTO v_ref_clinic_id FROM public.whatsapp_instances WHERE starts_with(NEW.session_id, phone_number) LIMIT 1;
        NEW.clinic_id := v_ref_clinic_id;
    END IF;

    -- [C] CAPTURA DO TELEFONE REAL
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

    -- [D] BUSCA POR PROTOCOLO
    v_msg_content := json_data->>'content';
    IF v_msg_content IS NOT NULL AND v_msg_content ILIKE '%protocolo%' THEN
        v_protocol_match := (regexp_matches(v_msg_content, 'protocolo:?\s*(\w+)', 'i'))[1];
        IF v_protocol_match IS NOT NULL THEN
            SELECT id INTO v_ref_lead_id FROM public.leads
            WHERE clinic_id = NEW.clinic_id
              AND (name ILIKE ('%Lead pendente%' || v_protocol_match || '%') OR name ILIKE ('%' || v_protocol_match || '%'));
        END IF;
    END IF;

    -- [E] BUSCA FINAL POR TELEFONE NORMALIZADO + CLINICA
    IF v_ref_lead_id IS NULL AND v_lead_phone IS NOT NULL AND NEW.clinic_id IS NOT NULL THEN
        SELECT id INTO v_ref_lead_id FROM public.leads
        WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = normalize_br_phone(v_lead_phone) LIMIT 1;
    END IF;

    -- [F] CRIACAO CASO NAO EXISTA (lead novo ja nasce com session_id)
    IF v_ref_lead_id IS NULL AND v_lead_phone IS NOT NULL AND NEW.clinic_id IS NOT NULL THEN
        INSERT INTO public.leads (clinic_id, name, phone, capture_channel, session_id)
        VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp', NEW.session_id)
        RETURNING id INTO v_ref_lead_id;
        IF v_ref_lead_id IS NULL THEN
            SELECT id INTO v_ref_lead_id FROM public.leads
            WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = normalize_br_phone(v_lead_phone) LIMIT 1;
        END IF;
    END IF;

    -- [G] BACKFILL DO SESSION_ID EM LEAD EXISTENTE (forms/app criam lead sem session_id)
    --     So preenche quando NULL; nao sobrescreve valor ja existente.
    IF v_ref_lead_id IS NOT NULL AND NEW.session_id IS NOT NULL THEN
        UPDATE public.leads
        SET session_id = NEW.session_id
        WHERE id = v_ref_lead_id AND session_id IS NULL;
    END IF;

    NEW.lead_id := v_ref_lead_id;
    NEW.phone := v_lead_phone;

    RETURN NEW;
END;
$function$;

-- Backfill dos leads ja existentes: pega o session_id da mensagem mais recente de cada lead.
UPDATE public.leads l
SET session_id = sub.session_id
FROM (
    SELECT DISTINCT ON (lead_id) lead_id, session_id
    FROM public.chat_messages
    WHERE session_id IS NOT NULL AND lead_id IS NOT NULL
    ORDER BY lead_id, seq DESC
) sub
WHERE l.id = sub.lead_id
  AND l.session_id IS NULL;
