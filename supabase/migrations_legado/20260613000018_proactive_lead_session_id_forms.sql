-- Complementa 20260613000017. Objetivo: lead de forms/app ja nasce com session_id
-- (evita a janela NULL em que o fluxo de boas-vindas do n8n atualiza por session_id
-- ANTES da 1a mensagem inbound existir).
--
-- Estrategia em 2 partes, porque a formula (clinic_phone || lead_phone) NAO e 100%
-- confiavel: ~30% dos leads tem session_id real (vindo do WhatsApp) diferente da formula,
-- por causa do 9o digito. Logo:
--   1) fn_set_lead_session_id (BEFORE INSERT em leads): se session_id vier NULL, calcula
--      o "melhor chute" = phone_number da clinica || telefone do lead (somente digitos,
--      SEM mexer no 9o digito, pra espelhar o que o n8n usa a partir do telefone do forms).
--      Para leads de WhatsApp, a master_logic ja insere com session_id != NULL -> este
--      trigger nao sobrescreve.
--   2) [G] da master_logic passa a ser CORRETIVO: sobrescreve quando o session_id real da
--      conversa diferir do gravado (antes so preenchia NULL). Assim o "chute" so cobre a
--      janela inicial e o valor autoritativo do WhatsApp sempre vence quando a conversa real
--      comeca. Seguro porque uq_leads_normalized_phone garante 1 lead por telefone (session
--      ~1:1 com o lead).

-- ============================================================================
-- Parte 1: trigger proativo no INSERT de leads
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_set_lead_session_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_clinic_phone TEXT;
    v_lead_phone   TEXT;
BEGIN
    IF NEW.session_id IS NULL
       AND NEW.phone IS NOT NULL AND NEW.phone <> ''
       AND NEW.clinic_id IS NOT NULL THEN
        v_lead_phone := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
        IF v_lead_phone <> '' THEN
            SELECT phone_number INTO v_clinic_phone
            FROM public.whatsapp_instances WHERE clinic_id = NEW.clinic_id LIMIT 1;
            IF v_clinic_phone IS NOT NULL AND v_clinic_phone <> '' THEN
                NEW.session_id := v_clinic_phone || v_lead_phone;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_set_lead_session_id ON public.leads;
CREATE TRIGGER trg_set_lead_session_id
    BEFORE INSERT ON public.leads
    FOR EACH ROW EXECUTE FUNCTION fn_set_lead_session_id();

-- ============================================================================
-- Parte 2: [G] da master_logic vira CORRETIVO (sobrescreve quando diferir)
-- ============================================================================
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

    -- [G] SINCRONIZA O SESSION_ID DO LEAD COM O DA CONVERSA REAL (autoritativo).
    --     Sobrescreve quando diferir do que o WhatsApp envia (o "chute" do INSERT de
    --     forms/app pode divergir pelo 9o digito). session_id ~1:1 com o lead.
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
