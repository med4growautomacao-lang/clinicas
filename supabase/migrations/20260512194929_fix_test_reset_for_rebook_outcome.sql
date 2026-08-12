-- 20260512194929_fix_test_reset_for_rebook_outcome
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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
$$;
