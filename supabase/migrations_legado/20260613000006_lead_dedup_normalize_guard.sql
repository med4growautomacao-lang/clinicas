-- Deduplicacao de lead robusta ao 9o digito (prevencao).
-- Antes: a guarda de unicidade e o master_logic do WhatsApp casavam telefone por igualdade
-- EXATA, e create_lead_with_ticket inseria cru. Resultado: criar lead/contato com o 9o
-- digito (ou formato diferente) duplicava a pessoa (1 lead no WhatsApp normalizado + 1
-- manual com 9) e ainda criava ticket sem lead quando o telefone ja existia.
-- Agora tudo casa por normalize_br_phone e o lead e gravado em forma canonica.

-- (1) Guarda de unicidade: canonicaliza o telefone do lead e casa por normalize.
CREATE OR REPLACE FUNCTION public.fn_handle_lead_uniqueness()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_existing_id uuid; v_nphone text;
BEGIN
  v_nphone := normalize_br_phone(NEW.phone);
  IF v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
    NEW.phone := v_nphone;
  END IF;

  IF NEW.rast_id IS NOT NULL AND NEW.rast_id <> '' THEN
    SELECT id INTO v_existing_id FROM public.leads WHERE clinic_id = NEW.clinic_id AND rast_id = NEW.rast_id LIMIT 1;
  END IF;
  IF v_existing_id IS NULL AND v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
    SELECT id INTO v_existing_id FROM public.leads
    WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.leads SET
      name = COALESCE(NULLIF(NEW.name, ''), name),
      phone = COALESCE(normalize_br_phone(NULLIF(NEW.phone, '')), phone),
      email = COALESCE(NULLIF(NEW.email, ''), email),
      source = COALESCE(NULLIF(NEW.source, ''), source),
      g_clid = COALESCE(NULLIF(NEW.g_clid, ''), g_clid),
      g_campaign_name = COALESCE(NULLIF(NEW.g_campaign_name, ''), g_campaign_name),
      g_adset_name = COALESCE(NULLIF(NEW.g_adset_name, ''), g_adset_name),
      g_ad_name = COALESCE(NULLIF(NEW.g_ad_name, ''), g_ad_name),
      g_term_name = COALESCE(NULLIF(NEW.g_term_name, ''), g_term_name),
      g_source_name = COALESCE(NULLIF(NEW.g_source_name, ''), g_source_name),
      fb_clid = COALESCE(NULLIF(NEW.fb_clid, ''), fb_clid),
      fb_campaign_name = COALESCE(NULLIF(NEW.fb_campaign_name, ''), fb_campaign_name),
      fb_adset_name = COALESCE(NULLIF(NEW.fb_adset_name, ''), fb_adset_name),
      fb_ad_name = COALESCE(NULLIF(NEW.fb_ad_name, ''), fb_ad_name),
      ctwa_clid = COALESCE(NULLIF(NEW.ctwa_clid, ''), ctwa_clid),
      capture_channel = COALESCE(NULLIF(NEW.capture_channel, ''), capture_channel),
      updated_at = (now() AT TIME ZONE 'America/Sao_Paulo')
    WHERE id = v_existing_id;
    RETURN NULL;
  END IF;
  RETURN NEW;
END; $function$;

-- (2) create_lead_with_ticket: find-or-create por normalize; NUNCA cria ticket sem lead.
CREATE OR REPLACE FUNCTION public.create_lead_with_ticket(p_clinic_id uuid, p_name text, p_phone text DEFAULT NULL, p_email text DEFAULT NULL, p_source text DEFAULT 'manual', p_capture_channel text DEFAULT 'manual', p_stage_id uuid DEFAULT NULL, p_estimated_value numeric DEFAULT NULL, p_avatar_url text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lead_id uuid; v_ticket_id uuid; v_stage_id uuid := p_stage_id; v_nphone text;
BEGIN
  v_nphone := normalize_br_phone(p_phone);
  IF v_stage_id IS NULL THEN SELECT id INTO v_stage_id FROM funnel_stages WHERE clinic_id=p_clinic_id ORDER BY position LIMIT 1; END IF;
  IF v_nphone IS NOT NULL AND length(v_nphone)>=12 THEN
    SELECT id INTO v_lead_id FROM leads WHERE clinic_id=p_clinic_id AND normalize_br_phone(phone)=v_nphone LIMIT 1;
  END IF;
  IF v_lead_id IS NULL THEN
    INSERT INTO leads (clinic_id, name, phone, email, source, capture_channel, estimated_value, avatar_url)
    VALUES (p_clinic_id, p_name, COALESCE(v_nphone, p_phone), p_email, p_source, p_capture_channel, p_estimated_value, p_avatar_url)
    RETURNING id INTO v_lead_id;
    IF v_lead_id IS NULL AND v_nphone IS NOT NULL THEN
      SELECT id INTO v_lead_id FROM leads WHERE clinic_id=p_clinic_id AND normalize_br_phone(phone)=v_nphone LIMIT 1;
    END IF;
  END IF;
  SELECT id INTO v_ticket_id FROM tickets WHERE lead_id=v_lead_id AND status='open' ORDER BY opened_at DESC LIMIT 1;
  IF v_ticket_id IS NULL THEN
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at) VALUES (p_clinic_id, v_lead_id, v_stage_id, 'open', now()) RETURNING id INTO v_ticket_id;
  END IF;
  RETURN jsonb_build_object('success', true, 'lead_id', v_lead_id, 'ticket_id', v_ticket_id, 'stage_id', v_stage_id);
END; $function$;

-- (3) master_logic (WhatsApp): [E] busca por normalize + [F] rede de seguranca pos-insert.
CREATE OR REPLACE FUNCTION public.handle_chat_message_master_logic()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
    json_data JSONB; v_ref_clinic_id UUID; v_ref_lead_id UUID; v_lead_phone TEXT; v_clinic_phone TEXT; v_msg_content TEXT; v_protocol_match TEXT;
BEGIN
    IF (NEW.message IS NOT NULL) THEN
        IF jsonb_typeof(NEW.message) = 'string' THEN
            BEGIN json_data := (NEW.message#>>'{}')::jsonb; NEW.message := json_data;
            EXCEPTION WHEN OTHERS THEN json_data := NEW.message; END;
        ELSE json_data := NEW.message; END IF;
        IF NEW.sender IS NULL OR NEW.sender = 'system' THEN
            DECLARE msg_role TEXT := COALESCE(json_data->>'role', json_data->>'type');
            BEGIN
                IF (msg_role = 'user' OR msg_role = 'human') THEN NEW.sender := 'human'; NEW.direction := 'inbound';
                ELSIF (msg_role IN ('ai','assistant','bot')) THEN NEW.sender := 'ai'; NEW.direction := 'outbound';
                ELSE NEW.sender := 'system'; NEW.direction := 'outbound'; END IF;
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
            ELSE v_lead_phone := NEW.session_id; END IF;
        END IF;
    END IF;
    v_msg_content := json_data->>'content';
    IF v_msg_content IS NOT NULL AND v_msg_content ILIKE '%protocolo%' THEN
        v_protocol_match := (regexp_matches(v_msg_content, 'protocolo:?\s*(\w+)', 'i'))[1];
        IF v_protocol_match IS NOT NULL THEN
            SELECT id INTO v_ref_lead_id FROM public.leads
            WHERE clinic_id = NEW.clinic_id AND (name ILIKE ('%Lead pendente%' || v_protocol_match || '%') OR name ILIKE ('%' || v_protocol_match || '%'));
        END IF;
    END IF;
    -- [E] busca pelo telefone NORMALIZADO (robusto ao 9o digito/formato)
    IF v_ref_lead_id IS NULL AND v_lead_phone IS NOT NULL AND NEW.clinic_id IS NOT NULL THEN
        SELECT id INTO v_ref_lead_id FROM public.leads
        WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = normalize_br_phone(v_lead_phone) LIMIT 1;
    END IF;
    -- [F] cria se nao existe; rede de seguranca se a guarda mesclou (RETURN NULL)
    IF v_ref_lead_id IS NULL AND v_lead_phone IS NOT NULL AND NEW.clinic_id IS NOT NULL THEN
        INSERT INTO public.leads (clinic_id, name, phone, capture_channel, session_id)
        VALUES (NEW.clinic_id, 'Lead ' || v_lead_phone, v_lead_phone, 'whatsapp', NEW.session_id)
        RETURNING id INTO v_ref_lead_id;
        IF v_ref_lead_id IS NULL THEN
            SELECT id INTO v_ref_lead_id FROM public.leads
            WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = normalize_br_phone(v_lead_phone) LIMIT 1;
        END IF;
    END IF;
    NEW.lead_id := v_ref_lead_id;
    NEW.phone := v_lead_phone;
    RETURN NEW;
END; $function$;
