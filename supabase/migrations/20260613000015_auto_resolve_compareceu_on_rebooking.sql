-- COMPARECEU tambem destrava o reagendamento (decisao do usuario 13/06, opcao "fechar ao
-- reagendar"): consulta ja ACONTECIDA (realizado OU compareceu), sem nada marcado ->
-- novo agendamento fecha a jornada antiga e abre nova em "Agendado".
-- A pendencia de finalizacao do compareceu (lancar valores) PERMANECE visivel na tela de
-- Agendamentos (consulta com status 'compareceu'); finalizar depois continua funcionando
-- (finalize_appointment lanca transacao/conversao e marca ganho no ticket ja fechado).
-- ATRASADA sem desfecho (pendente/confirmado < hoje) continua BLOQUEANDO (awaiting_finalization).
-- Mantida a invariante 1-ticket-aberto-por-lead (a jornada antiga fecha antes da nova abrir).
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
