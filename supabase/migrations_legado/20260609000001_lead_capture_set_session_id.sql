-- handle_chat_message_lead_capture: trigger BEFORE INSERT em chat_messages que
-- cria/acha o lead a partir da mensagem do WhatsApp (n8n). A mensagem já traz o
-- session_id real da IA, então gravamos ele no lead na criação (fonte confiável —
-- evita recalcular por fórmula, que diverge por 9º dígito e telefone editado).
-- Para lead já existente, preenche o session_id só se estiver vazio (não sobrescreve).
CREATE OR REPLACE FUNCTION public.handle_chat_message_lead_capture()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    found_lead_id UUID;
    lead_phone TEXT;
    clinic_phone TEXT;
BEGIN
    -- Se já tem lead_id, não faz nada
    IF NEW.lead_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Tenta pegar o telefone do lead
    lead_phone := NEW.phone;

    -- Se o telefone estiver vazio mas temos session_id, tentamos extrair
    -- Assumindo que o session_id é clinic_phone + lead_phone
    IF (lead_phone IS NULL OR lead_phone = '') AND NEW.session_id IS NOT NULL THEN
        -- Tenta pegar o telefone da clínica para saber onde cortar
        SELECT phone_number INTO clinic_phone
        FROM public.whatsapp_instances
        WHERE clinic_id = NEW.clinic_id
        LIMIT 1;

        IF clinic_phone IS NOT NULL AND clinic_phone <> '' AND starts_with(NEW.session_id, clinic_phone) THEN
            lead_phone := substr(NEW.session_id, length(clinic_phone) + 1);
        ELSIF length(NEW.session_id) >= 20 THEN
            -- Heurística: se o session_id é longo e não temos o tel da clínica,
            -- assume que os últimos 12 dígitos são o lead.
            lead_phone := right(NEW.session_id, 12);
        END IF;
    END IF;

    -- Se conseguimos um telefone, buscamos ou criamos o lead
    IF lead_phone IS NOT NULL AND lead_phone <> '' THEN
        -- Busca lead existente
        SELECT id INTO found_lead_id
        FROM public.leads
        WHERE clinic_id = NEW.clinic_id
        AND phone = lead_phone
        LIMIT 1;

        -- Se não existe, cria já com o session_id real da mensagem
        IF found_lead_id IS NULL THEN
            INSERT INTO public.leads (clinic_id, name, phone, source, session_id)
            VALUES (NEW.clinic_id, 'Número ' || lead_phone, lead_phone, 'whatsapp', NEW.session_id)
            RETURNING id INTO found_lead_id;
        ELSIF NEW.session_id IS NOT NULL THEN
            -- Lead já existe: preenche o session_id apenas se estiver vazio
            UPDATE public.leads
            SET session_id = NEW.session_id
            WHERE id = found_lead_id AND session_id IS NULL;
        END IF;

        -- Vincula o lead e o telefone à mensagem
        NEW.lead_id := found_lead_id;
        NEW.phone := lead_phone;
    END IF;

    RETURN NEW;
END;
$function$;
