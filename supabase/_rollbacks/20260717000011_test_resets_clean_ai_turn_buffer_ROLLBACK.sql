-- Rollback da 20260717000011 — restaura os resets SEM a limpeza do ai_turn_buffer.
-- (Se rodar este rollback, os nós Redis do Receptor NÃO voltam sozinhos — a
-- limpeza do buffer simplesmente deixa de acontecer nos resets, o que é inócuo:
-- o cron ai_turn_buffer_cleanup varre diariamente.)

CREATE OR REPLACE FUNCTION public.test_reset_for_rebook(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_lead_ids uuid[];
  v_open_ticket_ids uuid[];
  v_msgs_deleted int;
BEGIN
  SELECT array_agg(id) INTO v_lead_ids FROM leads WHERE phone = p_phone;

  SELECT array_agg(id) INTO v_open_ticket_ids
    FROM tickets WHERE lead_id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]))
      AND status <> 'closed';

  UPDATE tickets
     SET status = 'closed',
         closed_at = COALESCE(closed_at, now()),
         outcome = COALESCE(outcome, 'perdido'),
         outcome_at = COALESCE(outcome_at, now())
   WHERE id = ANY(COALESCE(v_open_ticket_ids, ARRAY[]::uuid[]));

  DELETE FROM chat_messages WHERE phone = p_phone OR lead_id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]));
  GET DIAGNOSTICS v_msgs_deleted = ROW_COUNT;

  DELETE FROM leads WHERE id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]));

  RETURN jsonb_build_object(
    'mode', 'rebook_reset',
    'phone', p_phone,
    'deleted', jsonb_build_object(
      'leads', COALESCE(array_length(v_lead_ids, 1), 0),
      'chat_messages', v_msgs_deleted
    ),
    'closed_tickets', COALESCE(array_length(v_open_ticket_ids, 1), 0),
    'preserved', jsonb_build_array('patients', 'appointments', 'conversions', 'financial_transactions', 'medical_records', 'tickets')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.test_reset_full(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_lead_ids uuid[];
  v_patient_ids uuid[];
  v_appt_ids uuid[];
  v_ticket_ids uuid[];
  v_msgs_deleted int;
BEGIN
  SELECT array_agg(id) INTO v_lead_ids FROM leads WHERE phone = p_phone;
  SELECT array_agg(id) INTO v_patient_ids FROM patients WHERE phone = p_phone;
  SELECT array_agg(id) INTO v_appt_ids
    FROM appointments WHERE patient_id = ANY(COALESCE(v_patient_ids, ARRAY[]::uuid[]));
  SELECT array_agg(id) INTO v_ticket_ids
    FROM tickets WHERE lead_id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]))
       OR id IN (SELECT ticket_id FROM appointments WHERE id = ANY(COALESCE(v_appt_ids, ARRAY[]::uuid[])));

  DELETE FROM financial_transactions WHERE appointment_id = ANY(COALESCE(v_appt_ids, ARRAY[]::uuid[]))
    OR patient_id = ANY(COALESCE(v_patient_ids, ARRAY[]::uuid[]));
  DELETE FROM medical_records WHERE patient_id = ANY(COALESCE(v_patient_ids, ARRAY[]::uuid[]));
  DELETE FROM prescriptions WHERE patient_id = ANY(COALESCE(v_patient_ids, ARRAY[]::uuid[]));
  DELETE FROM exam_requests WHERE patient_id = ANY(COALESCE(v_patient_ids, ARRAY[]::uuid[]));
  DELETE FROM appointments WHERE id = ANY(COALESCE(v_appt_ids, ARRAY[]::uuid[]));
  DELETE FROM tickets WHERE id = ANY(COALESCE(v_ticket_ids, ARRAY[]::uuid[]));
  DELETE FROM conversions WHERE lead_id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]));
  DELETE FROM chat_messages WHERE phone = p_phone OR lead_id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]));
  GET DIAGNOSTICS v_msgs_deleted = ROW_COUNT;
  DELETE FROM leads WHERE id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]));
  DELETE FROM patients WHERE id = ANY(COALESCE(v_patient_ids, ARRAY[]::uuid[]));

  RETURN jsonb_build_object(
    'mode', 'full_reset',
    'phone', p_phone,
    'deleted', jsonb_build_object(
      'leads', COALESCE(array_length(v_lead_ids, 1), 0),
      'patients', COALESCE(array_length(v_patient_ids, 1), 0),
      'appointments', COALESCE(array_length(v_appt_ids, 1), 0),
      'tickets', COALESCE(array_length(v_ticket_ids, 1), 0),
      'chat_messages', v_msgs_deleted
    )
  );
END;
$function$;
