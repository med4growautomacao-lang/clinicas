-- Normaliza o casamento de telefone nos triggers de vínculo de agendamento.
--
-- Contexto: fn_auto_link_ticket_on_appointment (BEFORE INSERT) e
-- fn_auto_move_lead_to_agendado (AFTER INSERT) casavam o lead por IGUALDADE EXATA de
-- telefone (l.phone = v_phone / p.phone = l.phone). Quando o telefone do paciente difere
-- em formato (9o digito, +55, etc.) do lead existente, o match falha -> o trigger cria
-- um lead/ticket DUPLICADO em "agendado" e o lead original fica preso numa etapa
-- reengajavel -> reengajamento dispara para quem ja agendou (mesmo sintoma do bug da IA).
--
-- Correcao: casar sempre por normalize_br_phone() nos dois lados, igual a book_appointment.
-- Bonus: fn_auto_link passa a ignorar telefone invalido (normalizado < 12 digitos) em vez
-- de criar lead/ticket com telefone lixo.

CREATE OR REPLACE FUNCTION public.fn_auto_link_ticket_on_appointment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_lead_id   uuid;
  v_phone     text;
  v_nphone    text;
  v_name      text;
  v_stage_id  uuid;
BEGIN
  -- 1) Ja veio com ticket_id: respeita
  IF NEW.ticket_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2) Pega phone + name do paciente
  SELECT phone, name INTO v_phone, v_name
  FROM patients WHERE id = NEW.patient_id;

  v_nphone := normalize_br_phone(v_phone);
  IF v_nphone IS NULL OR length(v_nphone) < 12 THEN
    RETURN NEW;  -- sem telefone utilizavel: nao linka, nao cria duplicado com lixo
  END IF;

  -- 3) Procura ticket aberto via lead com mesmo phone (NORMALIZADO)
  SELECT t.id INTO v_ticket_id
  FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE l.clinic_id = NEW.clinic_id
    AND normalize_br_phone(l.phone) = v_nphone
    AND t.status    = 'open'
  ORDER BY t.opened_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL THEN
    NEW.ticket_id := v_ticket_id;
    RETURN NEW;
  END IF;

  -- 4) Nao achou ticket aberto: cria lead (se necessario) + ticket
  SELECT id INTO v_lead_id
  FROM leads
  WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = v_nphone
  LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, converted_patient_id)
    VALUES (NEW.clinic_id, COALESCE(v_name, 'Paciente'), v_phone, 'manual', 'manual', false, NEW.patient_id)
    RETURNING id INTO v_lead_id;
  ELSE
    UPDATE leads
       SET converted_patient_id = COALESCE(converted_patient_id, NEW.patient_id)
     WHERE id = v_lead_id;
  END IF;

  -- 5) Stage 'agendado' da clinica
  SELECT id INTO v_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado'
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 6) Cria ticket
  INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
  VALUES (NEW.clinic_id, v_lead_id, v_stage_id, 'open', now())
  RETURNING id INTO NEW.ticket_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_to_agendado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_target_stage_id uuid;
BEGIN
  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    SELECT t.id INTO v_ticket_id
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON normalize_br_phone(p.phone) = normalize_br_phone(l.phone) AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id AND t.status = 'open'
    LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_target_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado' LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  -- Toda vez que cria appointment ativo (status != cancelado/faltou, filtrado pelo trigger WHEN),
  -- o ticket vai pra "Agendado" — sem condicional de posicao.
  -- Limpa outcome se vinha de estado encerrado (ressurreicao, novo ciclo).
  UPDATE tickets
    SET stage_id = v_target_stage_id,
        outcome = NULL,
        outcome_at = NULL
  WHERE id = v_ticket_id
    AND stage_id IS DISTINCT FROM v_target_stage_id;

  RETURN NEW;
END;
$function$;
