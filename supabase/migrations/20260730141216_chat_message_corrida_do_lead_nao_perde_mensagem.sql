-- Mensagem de WhatsApp sumindo quando o contato e NOVO e chegam dois eventos no mesmo segundo.
--
-- O QUE ACONTECIA (provado no vivo, Clinica Sao Lucas 29/07 17:40): o paciente manda a primeira
-- mensagem (17:40:03) e a resposta automatica da clinica volta 1 segundo depois (17:40:04). Sao
-- dois webhooks CONCORRENTES para um contato que ainda nao existe. Os dois tentam criar o mesmo
-- lead; um ganha e o outro morre com
--     duplicate key value violates unique constraint "leads_clinic_id_phone_key"
-- Como este e um trigger BEFORE INSERT, o erro derruba o INSERT INTEIRO em chat_messages: a
-- transacao volta atras e a mensagem NAO fica em lugar nenhum. Foram 90 falhas desde 17/07, e a
-- ultima (id A5CEBC2DFF6E892F738B88583DCAC097) segue ausente do banco 17 horas depois, ou seja,
-- o reenvio da uazapi NAO recupera. O registro na Central dizia "falha ao persistir", mas quem
-- lia entendia "tentou de novo e deu certo".
--
-- POR QUE ESCAPAVA justamente aqui: o ingest_wa_message ja trata essa corrida, mas so no caminho
-- INBOUND (ele nao cria lead para outbound, de proposito). Para a mensagem que a clinica ENVIA a
-- um contato novo, quem acaba criando o lead e este trigger, e aqui o insert estava cru.
--
-- A CORRECAO e a mesma regra da casa: perdeu a corrida, releia. Nao inventa lead, nao engole erro
-- de outro tipo (so unique_violation) e nao muda quem ganha, so para de jogar a mensagem fora.
--
-- ⚠️ O bloco `IF v_ref_lead_id IS NULL` logo abaixo do insert NAO e redundante com o EXCEPTION:
-- ele cobre o caso em que o fn_handle_lead_uniqueness (BEFORE INSERT em leads) suprime a linha
-- devolvendo NULL por ser duplicata da MESMA transacao. Sao duas corridas diferentes: a de dentro
-- da transacao e a de fora. Tirar um dos dois reabre metade do defeito.
--
-- ⚠️ SUPERSEDIDA em parte por 20260730142822: esta versao declarou `security definer` por engano
-- (o original era INVOKER). O conteudo abaixo fica como historia; o estado atual e o da outra.
create or replace function public.handle_chat_message_master_logic()
returns trigger
language plpgsql
security definer
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
        BEGIN
            INSERT INTO public.leads (clinic_id, name, phone, capture_channel, session_id)
            VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp', NEW.session_id)
            RETURNING id INTO v_ref_lead_id;
        EXCEPTION WHEN unique_violation THEN
            -- Corrida com o outro webhook do mesmo segundo: ele criou o lead primeiro. Zera para
            -- cair na releitura abaixo em vez de derrubar a mensagem junto.
            v_ref_lead_id := NULL;
        END;

        IF v_ref_lead_id IS NULL THEN
            -- Releitura cobrindo as DUAS unicas de leads: a do telefone cru (clinic_id, phone) e a
            -- do normalizado. Comparar so por uma delas deixa a metade dos empates sem lead.
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
