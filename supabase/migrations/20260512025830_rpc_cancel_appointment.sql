-- 20260512025830_rpc_cancel_appointment
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Cancela appointment de forma atômica + reverte transações relacionadas
CREATE OR REPLACE FUNCTION public.cancel_appointment(
  p_appointment_id uuid,
  p_reason text DEFAULT NULL,
  p_revert_transaction boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_apt RECORD;
  v_reverted_tx_count int := 0;
BEGIN
  SELECT * INTO v_apt FROM appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'appointment_not_found');
  END IF;

  IF v_apt.status = 'cancelado' THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  -- Cancela
  UPDATE appointments SET
    status = 'cancelado',
    notes = COALESCE(notes || E'\n', '') || COALESCE('[Cancelado] ' || p_reason, '[Cancelado]')
  WHERE id = p_appointment_id;

  -- Se foi realizado e tinha transação financeira pendente/paga, reverte
  IF p_revert_transaction AND v_apt.status = 'realizado' THEN
    UPDATE financial_transactions
    SET status = 'cancelado',
        description = COALESCE(description, '') || ' [Consulta cancelada]'
    WHERE appointment_id = p_appointment_id
      AND status <> 'cancelado';
    GET DIAGNOSTICS v_reverted_tx_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'appointment_id', p_appointment_id,
    'previous_status', v_apt.status,
    'reverted_transactions', v_reverted_tx_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_appointment(uuid, text, boolean) TO anon, authenticated, service_role;
