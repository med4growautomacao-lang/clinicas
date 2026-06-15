-- Incidente 15/06: a IA voltou a atender um lead JA GANHO (paciente da secretaria).
-- Causa: registrar manualmente uma consulta PASSADA como 'realizado' num lead ganho faz
-- book_appointment -> fn_resolve_patient_lead_ticket FECHAR o ticket ganho antigo e ABRIR um
-- novo (reciclagem). O fechamento dispara fn_activate_ai_on_ticket_resolved, que religa
-- ai_enabled=true (unico caminho no banco que liga a IA). De quebra, o ticket novo nasce
-- "aberto+ganho" e a venda passa a contar 2x.
--
-- Part 1: fechamento de ticket GANHO nao religa mais a IA (lead ganho fica com o humano).
-- Part 2: registro retroativo num ganho SEM consulta registrada REUSA o ticket (em vez de
--         fechar+recriar), eliminando o ticket duplicado e o fechamento que religava a IA.

-- ============================================================================
-- Part 1 — fn_activate_ai_on_ticket_resolved: nao reativar a IA em desfecho 'ganho'
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_activate_ai_on_ticket_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Religa a IA quando o ticket e resolvido (closed) APENAS se o desfecho NAO for 'ganho'.
  -- Lead ganho e cliente/paciente -> segue com o humano (secretaria). Reativacao continua
  -- valendo para 'perdido'/neutro (re-engajar lead que nao fechou).
  IF NEW.status = 'closed'
     AND OLD.status IS DISTINCT FROM 'closed'
     AND NEW.lead_id IS NOT NULL
     AND NEW.outcome IS DISTINCT FROM 'ganho' THEN
    UPDATE leads
      SET ai_enabled = true
      WHERE id = NEW.lead_id
        AND ai_enabled = false;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- Part 2 — fn_resolve_patient_lead_ticket: reusar ticket ganho SEM consulta ativa
-- ============================================================================
-- Mantida toda a logica anterior (20260613000015). Unica mudanca: o bloco de reciclagem
-- so FECHA+RECRIA quando o ticket ganho ja tem uma consulta ATIVA (ciclo real de retorno);
-- se for um ganho sem consulta ativa (ex.: ganho manual/prematuro, ou registro retroativo),
-- REUSA o ticket -> a nova consulta anexa nele (indice appointments_one_active_per_ticket
-- permite, pois nao ha consulta ativa), evitando ticket ganho duplicado e o fechamento que
-- religaria a IA. Rebooking normal (ganho ja com 'realizado'/'compareceu') segue inalterado.
CREATE OR REPLACE FUNCTION public.fn_resolve_patient_lead_ticket(
  p_clinic_id uuid, p_patient_id uuid, p_lead_id uuid, p_name text, p_phone text,
  OUT o_patient_id uuid, OUT o_lead_id uuid, OUT o_ticket_id uuid)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$
DECLARE v_nphone text; v_lead_name text; v_lead_phone text; v_lead_converted uuid; v_name text; v_phone text; v_stage_id uuid;
BEGIN
  v_nphone := normalize_br_phone(p_phone);
  IF p_lead_id IS NOT NULL THEN
    SELECT id, name, phone, converted_patient_id INTO o_lead_id, v_lead_name, v_lead_phone, v_lead_converted
    FROM leads WHERE id=p_lead_id AND clinic_id=p_clinic_id;
  END IF;
  o_patient_id := p_patient_id;
  IF o_patient_id IS NULL AND o_lead_id IS NOT NULL THEN o_patient_id := v_lead_converted; END IF;
  IF o_patient_id IS NULL AND v_nphone IS NOT NULL THEN
    SELECT id INTO o_patient_id FROM patients WHERE clinic_id=p_clinic_id AND normalize_br_phone(phone)=v_nphone LIMIT 1;
  END IF;
  IF o_patient_id IS NULL THEN
    v_name := COALESCE(NULLIF(p_name,''), v_lead_name, 'Paciente');
    v_phone := COALESCE(NULLIF(p_phone,''), v_lead_phone);
    INSERT INTO patients (clinic_id, name, phone) VALUES (p_clinic_id, v_name, v_phone) RETURNING id INTO o_patient_id;
  END IF;
  IF v_nphone IS NULL THEN SELECT normalize_br_phone(phone) INTO v_nphone FROM patients WHERE id=o_patient_id; END IF;
  IF o_lead_id IS NULL AND v_nphone IS NOT NULL THEN
    SELECT id INTO o_lead_id FROM leads WHERE clinic_id=p_clinic_id AND normalize_br_phone(phone)=v_nphone ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF o_lead_id IS NULL THEN
    IF v_nphone IS NOT NULL THEN
      SELECT name, phone INTO v_name, v_phone FROM patients WHERE id=o_patient_id;
      INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, converted_patient_id)
      VALUES (p_clinic_id, COALESCE(v_name,'Paciente'), v_phone, 'manual','manual', false, o_patient_id) RETURNING id INTO o_lead_id;
    END IF;
  ELSE
    UPDATE leads SET converted_patient_id=COALESCE(converted_patient_id, o_patient_id) WHERE id=o_lead_id;
  END IF;
  IF o_lead_id IS NOT NULL THEN
    SELECT id INTO o_ticket_id FROM tickets WHERE lead_id=o_lead_id AND status='open' ORDER BY opened_at DESC LIMIT 1;

    IF o_ticket_id IS NOT NULL
       AND (EXISTS (SELECT 1 FROM tickets t WHERE t.id=o_ticket_id AND t.outcome='ganho')
            OR EXISTS (SELECT 1 FROM appointments a WHERE a.ticket_id=o_ticket_id AND a.status IN ('realizado','compareceu')))
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.ticket_id=o_ticket_id AND a.status IN ('pendente','confirmado')) THEN
      -- So recicla (fecha+recria) se o ticket ganho ja tem consulta ATIVA (retorno real).
      -- Ganho SEM consulta ativa -> REUSA o ticket (nova consulta anexa nele; sem duplicar, sem religar IA).
      IF EXISTS (SELECT 1 FROM appointments a WHERE a.ticket_id=o_ticket_id AND a.status NOT IN ('cancelado','faltou')) THEN
        UPDATE tickets SET status='closed', closed_at=now() WHERE id=o_ticket_id;
        o_ticket_id := NULL;
      END IF;
    END IF;

    IF o_ticket_id IS NULL THEN
      SELECT id INTO v_stage_id FROM funnel_stages WHERE clinic_id=p_clinic_id AND slug='agendado' LIMIT 1;
      IF v_stage_id IS NOT NULL THEN
        INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
        VALUES (p_clinic_id, o_lead_id, v_stage_id, 'open', now()) RETURNING id INTO o_ticket_id;
      END IF;
    END IF;
  END IF;
END; $f$;
