-- O protocolo casava por SUBSTRING no NOME do lead — e grudava a conversa em quem não devia.
--
-- Como o lead do site chega: o script do site pede um protocolo, o n8n cria um lead placeholder
-- chamado "Lead Pendente - 4829" (sem telefone) carregando gclid/UTMs, e o site abre o WhatsApp com
-- "[Protocolo 4829]" na 1ª mensagem. Quando a mensagem entra, ESTA função casa o protocolo com o
-- placeholder e liga a conversa a ele.
--
-- O casamento era assim:
--
--   AND (name ILIKE ('%Lead pendente%' || proto || '%') OR name ILIKE ('%' || proto || '%'))
--
-- O segundo ramo casa QUALQUER lead cujo nome CONTENHA os dígitos. E lead de WhatsApp se chama
-- "Lead <telefone>". Ou seja: um protocolo de 4 dígitos casa com qualquer telefone que contenha
-- aqueles 4 dígitos — e não havia LIMIT nem ORDER BY, então o SELECT INTO pegava uma linha
-- ARBITRÁRIA.
--
-- Medido em produção (não é teoria):
--   · 3.250 mensagens com protocolo
--   · 619 (19%) foram para o lead ERRADO — telefone da mensagem ≠ telefone do lead
--   · 124 leads receberam conversa de estranhos
--   · 531 protocolos foram extraídos com MENOS de 4 dígitos: a regex era (\w+), então
--     "protocolo 2" virava proto='2' e casava com quase todo mundo. Na Rent a Wish, OITO pessoas
--     diferentes tiveram a 1ª mensagem grudada no mesmo Lead 554284294606.
--   · Exemplos reais: proto 4788 -> Lead 5551919(4788)5 · proto 4244 -> Lead 55518056(4244)
--
-- Efeito para o cliente: a 1ª mensagem do lead do Google aparece na conversa de OUTRA pessoa, e a
-- IA responde no contexto errado. É a família "conversa sumiu do lead".
--
-- ── O FIX (3 travas) ────────────────────────────────────────────────────────────────────────
--
-- 1) `phone IS NULL` — a trava que resolve sozinha. O placeholder NASCE sem telefone; lead real
--    SEMPRE tem. Verificado: leads reais sem telefone hoje = 0. Isso elimina a classe inteira de
--    colisão, porque todo lead "vítima" tinha telefone.
-- 2) Protocolo exige >= 4 DÍGITOS e casa como TOKEN, não substring (fronteira \D nas duas pontas).
-- 3) TTL + ORDER BY + LIMIT 1 — protocolo é efêmero; e nunca mais uma linha arbitrária.
--
-- ⚠️ O TTL usa `now() AT TIME ZONE 'America/Sao_Paulo'` DE PROPÓSITO: `leads.created_at` é
--    `timestamp` SEM timezone e seu default é justamente esse. Comparar com `now()` puro (UTC)
--    embutiria 3h de desvio e o matcher pararia de casar — em silêncio.
--
-- Nada mais da função muda: a queda para busca por telefone e a criação do lead seguem iguais.

begin;

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

    -- ── Protocolo do site (Google/redirecionamento) ──────────────────────────────────────────
    v_msg_content := json_data->>'content';
    IF v_msg_content IS NOT NULL AND v_msg_content ILIKE '%protocolo%' THEN
        -- Exige 4+ DÍGITOS. A regex antiga era (\w+): "protocolo 2" virava '2' e casava com
        -- qualquer telefone que tivesse um 2. 531 mensagens caíram nisso.
        v_protocol_match := (regexp_matches(v_msg_content, 'protocolo:?\s*([0-9]{4,})', 'i'))[1];

        IF v_protocol_match IS NOT NULL THEN
            SELECT id INTO v_ref_lead_id
            FROM public.leads
            WHERE clinic_id = NEW.clinic_id
              -- (1) Só placeholder. Lead real SEMPRE tem telefone; o placeholder nasce sem.
              --     Esta linha sozinha mata a colisão: as 124 vítimas todas tinham telefone.
              AND (phone IS NULL OR phone = '')
              AND name ILIKE '%pendente%'
              -- (2) TOKEN, não substring: o protocolo tem de estar cercado por não-dígito.
              --     v_protocol_match é garantidamente só dígitos, então não há injeção de regex.
              AND name ~ ('(^|\D)' || v_protocol_match || '(\D|$)')
              -- (3) Teto de idade: impede colar um placeholder fóssil num lead novo. 7 dias é
              --     folgado de propósito — o normal é a mensagem chegar em segundos (o site
              --     redireciona na hora), mas quem abre o WhatsApp e só envia no dia seguinte NÃO
              --     pode perder a atribuição. Quem faz o trabalho pesado aqui é o `phone IS NULL`,
              --     não o tempo. Se houver 2 placeholders com o mesmo protocolo, o ORDER BY abaixo
              --     pega o mais novo — que é o certo.
              --     São Paulo de propósito — ver comentário no topo.
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

    -- [G] SINCRONIZA session_id do lead com o da conversa real (autoritativo)
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

commit;

-- ============================================================================
-- ROLLBACK: reaplicar a versão anterior desta função (o bloco do protocolo era):
--   v_protocol_match := (regexp_matches(v_msg_content, 'protocolo:?\s*(\w+)', 'i'))[1];
--   SELECT id INTO v_ref_lead_id FROM public.leads
--   WHERE clinic_id = NEW.clinic_id
--     AND (name ILIKE ('%Lead pendente%' || v_protocol_match || '%')
--       OR name ILIKE ('%' || v_protocol_match || '%'));
-- (não recomendado — é o bug)
-- ============================================================================
