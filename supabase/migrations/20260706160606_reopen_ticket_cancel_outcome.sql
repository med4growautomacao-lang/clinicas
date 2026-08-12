-- 20260706160606_reopen_ticket_cancel_outcome
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.reopen_ticket(
  p_ticket_id uuid,
  p_new_stage_id uuid,
  p_cancel_appointment boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead        uuid;
  v_clinic      uuid;
  v_outcome     text;
  v_outcome_at  timestamptz;
  v_status      text;
  v_patient     uuid;
  v_new_slug    text;
  v_tx_ids      uuid[] := '{}';
  v_conv        RECORD;
  v_match       uuid;
BEGIN
  SELECT lead_id, clinic_id, outcome, outcome_at, status
    INTO v_lead, v_clinic, v_outcome, v_outcome_at, v_status
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF v_new_slug IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  IF v_new_slug IN ('ganho', 'perdido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'target_must_be_active');
  END IF;

  SELECT converted_patient_id INTO v_patient FROM leads WHERE id = v_lead;

  UPDATE tickets
    SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE lead_id = v_lead AND id <> p_ticket_id AND status = 'open';

  IF v_outcome = 'ganho' THEN
    v_tx_ids := ARRAY(
      SELECT c.financial_transaction_id FROM conversions c
      WHERE c.ticket_id = p_ticket_id AND c.financial_transaction_id IS NOT NULL
      UNION
      SELECT ft.id FROM financial_transactions ft
      JOIN appointments a ON a.id = ft.appointment_id
      WHERE a.ticket_id = p_ticket_id AND ft.type = 'receita'
    );

    IF v_patient IS NOT NULL THEN
      FOR v_conv IN
        SELECT value, converted_at::date AS cdate FROM conversions
        WHERE ticket_id = p_ticket_id
           OR (lead_id = v_lead AND ticket_id IS NULL
               AND (v_outcome_at IS NULL
                    OR created_at BETWEEN v_outcome_at - interval '1 hour' AND v_outcome_at + interval '1 hour'))
      LOOP
        SELECT ft.id INTO v_match
        FROM financial_transactions ft
        WHERE ft.clinic_id = v_clinic AND ft.type = 'receita'
          AND ft.patient_id = v_patient
          AND ft.amount = v_conv.value
          AND ft.date BETWEEN v_conv.cdate - 3 AND v_conv.cdate + 3
          AND NOT (ft.id = ANY(v_tx_ids))
        ORDER BY abs(ft.date - v_conv.cdate)
        LIMIT 1;
        IF v_match IS NOT NULL THEN
          v_tx_ids := array_append(v_tx_ids, v_match);
        END IF;
      END LOOP;
    END IF;

    DELETE FROM conversions
    WHERE ticket_id = p_ticket_id
       OR (lead_id = v_lead AND ticket_id IS NULL
           AND (v_outcome_at IS NULL
                OR created_at BETWEEN v_outcome_at - interval '1 hour' AND v_outcome_at + interval '1 hour'));

    IF array_length(v_tx_ids, 1) > 0 THEN
      DELETE FROM financial_transactions WHERE id = ANY(v_tx_ids);
    END IF;

    IF p_cancel_appointment THEN
      UPDATE appointments SET status = 'cancelado'
      WHERE ticket_id = p_ticket_id AND status NOT IN ('cancelado', 'faltou');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM appointments
      WHERE ticket_id = p_ticket_id AND status NOT IN ('cancelado', 'faltou')
    ) THEN
      UPDATE leads SET converted_patient_id = NULL WHERE id = v_lead;
    END IF;
  END IF;

  UPDATE tickets
    SET stage_id = p_new_stage_id, status = 'open', closed_at = NULL, loss_reason = NULL
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'new_stage_id', p_new_stage_id,
    'reopened', true,
    'cancelled_outcome', v_outcome,
    'removed_transactions', COALESCE(array_length(v_tx_ids, 1), 0)
  );
END;
$function$;
