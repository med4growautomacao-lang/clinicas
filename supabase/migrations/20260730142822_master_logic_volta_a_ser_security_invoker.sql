-- Correcao de rota da migration 20260730141216. Ao reescrever o trigger eu declarei
-- `security definer`, e o original (20260714000012) era plpgsql puro, ou seja, INVOKER. A
-- diferenca nao aparece em teste nenhum: como DEFINER a criacao do lead dentro do trigger passaria
-- a rodar com o dono da funcao e ignorar a RLS de leads. Nao ha ganho nisso (quem insere em
-- chat_messages ja passou pela RLS de chat_messages) e ha risco: privilegio ampliado em silencio
-- num trigger que roda em TODA mensagem do sistema.
--
-- Volta a ser INVOKER. Mantido apenas o `set search_path to 'public'`, que nao mexe em permissao,
-- so impede que a funcao resolva objeto por um search_path de fora.
--
-- O conteudo e identico ao da 20260730141216: a protecao contra a corrida na criacao do lead
-- continua, e e o motivo daquela migration existir (mensagem de WhatsApp sumindo quando o contato
-- e novo e chegam dois eventos no mesmo segundo).
create or replace function public.handle_chat_message_master_logic()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
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
        -- ⚠️ Perder a corrida aqui derrubava a mensagem inteira: este e um trigger BEFORE INSERT,
        -- entao o unique_violation na criacao do lead abortava o INSERT em chat_messages e a
        -- mensagem nao ficava em lugar nenhum. Ver 20260730141216.
        BEGIN
            INSERT INTO public.leads (clinic_id, name, phone, capture_channel, session_id)
            VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp', NEW.session_id)
            RETURNING id INTO v_ref_lead_id;
        EXCEPTION WHEN unique_violation THEN
            v_ref_lead_id := NULL;
        END;

        IF v_ref_lead_id IS NULL THEN
            -- Cobre as DUAS corridas: a de fora (outro webhook ja commitou o lead) e a de dentro
            -- da transacao (o fn_handle_lead_uniqueness devolve NULL quando funde duplicata).
            SELECT id INTO v_ref_lead_id FROM public.leads
            WHERE clinic_id = NEW.clinic_id
              AND (phone = v_lead_phone OR normalize_br_phone(phone) = normalize_br_phone(v_lead_phone))
            ORDER BY last_activity_at DESC NULLS LAST
            LIMIT 1;
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
