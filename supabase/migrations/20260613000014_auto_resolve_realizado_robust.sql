-- "Realizado = ganho" robusto no auto-resolve do retorno.
-- Conferido em prod: realizado quase sempre implica tickets.outcome='ganho' (trigger
-- fn_auto_move_lead_on_status_change / finalize_appointment), mas ha casos raros em que o
-- outcome nao e setado (condicao de posicao do funil no trigger) ou foi sobrescrito.
-- Regra do usuario: consulta REALIZADA = jornada ganha -> novo agendamento auto-resolve
-- (fecha a jornada e abre nova), independente do outcome gravado.
-- Mantido: COMPARECEU sem finalizar e ATRASADA bloqueiam (secretaria lanca valores);
-- cancelado/faltou remarcam no MESMO ticket.
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
            OR EXISTS (SELECT 1 FROM appointments a WHERE a.ticket_id=o_ticket_id AND a.status='realizado'))
       AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.ticket_id=o_ticket_id AND a.status IN ('pendente','confirmado')) THEN
      UPDATE tickets SET status='closed', closed_at=now() WHERE id=o_ticket_id;
      o_ticket_id := NULL;
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
