-- 20260512184645_add_ticket_summary_and_test_reset_rpcs
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Campo de resumo no ticket (1 por ciclo)
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS summary text;
COMMENT ON COLUMN tickets.summary IS
  'Resumo da jornada do ciclo (preenchido pelo agent quando o ticket fecha). Usado pra dar contexto ao retorno do paciente.';

-- 2. RPC: TESTE — primeiro contato absoluto (apaga TUDO de um phone)
CREATE OR REPLACE FUNCTION test_reset_full(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead_ids uuid[];
  v_patient_ids uuid[];
  v_appt_ids uuid[];
  v_ticket_ids uuid[];
  v_msgs_deleted int;
BEGIN
  -- Coleta IDs por phone
  SELECT array_agg(id) INTO v_lead_ids FROM leads WHERE phone = p_phone;
  SELECT array_agg(id) INTO v_patient_ids FROM patients WHERE phone = p_phone;
  SELECT array_agg(id) INTO v_appt_ids
    FROM appointments WHERE patient_id = ANY(COALESCE(v_patient_ids, ARRAY[]::uuid[]));
  SELECT array_agg(id) INTO v_ticket_ids
    FROM tickets WHERE lead_id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]))
       OR id IN (SELECT ticket_id FROM appointments WHERE id = ANY(COALESCE(v_appt_ids, ARRAY[]::uuid[])));

  -- Apaga em ordem segura (filhas antes)
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
$$;

-- 3. RPC: TESTE — paciente de reagendamento
--    Apaga lead, chat e tickets abertos.
--    MANTÉM: paciente, appointments, conversions, financial_transactions, medical_records.
--    Fecha o último ticket aberto preservando seu summary se já tiver.
CREATE OR REPLACE FUNCTION test_reset_for_rebook(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_lead_ids uuid[];
  v_open_ticket_ids uuid[];
  v_msgs_deleted int;
BEGIN
  SELECT array_agg(id) INTO v_lead_ids FROM leads WHERE phone = p_phone;

  -- Fecha tickets abertos do lead (mantém summary se já preenchido)
  SELECT array_agg(id) INTO v_open_ticket_ids
    FROM tickets WHERE lead_id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]))
      AND status <> 'closed';

  UPDATE tickets
     SET status = 'closed',
         closed_at = COALESCE(closed_at, now()),
         outcome = COALESCE(outcome, 'cancelado'),
         outcome_at = COALESCE(outcome_at, now())
   WHERE id = ANY(COALESCE(v_open_ticket_ids, ARRAY[]::uuid[]));

  -- Apaga chat (memória conversacional)
  DELETE FROM chat_messages WHERE phone = p_phone OR lead_id = ANY(COALESCE(v_lead_ids, ARRAY[]::uuid[]));
  GET DIAGNOSTICS v_msgs_deleted = ROW_COUNT;

  -- Apaga lead (tickets ficam preservados por SET NULL; paciente preservado por design)
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
$$;
