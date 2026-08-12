-- 20260512025845_rpc_finalize_ticket
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Finaliza ticket (ganho/perdido) + atualiza lead + audita
CREATE OR REPLACE FUNCTION public.finalize_ticket(
  p_ticket_id uuid,
  p_outcome text, -- 'ganho' | 'perdido'
  p_loss_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
  v_target_slug text;
  v_target_stage_id uuid;
  v_old_stage_id uuid;
BEGIN
  IF p_outcome NOT IN ('ganho', 'perdido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_outcome');
  END IF;

  SELECT id, lead_id, stage_id, clinic_id, status INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  v_old_stage_id := v_ticket.stage_id;
  v_target_slug := p_outcome; -- 'ganho' ou 'perdido'

  -- Acha a stage de destino
  SELECT id INTO v_target_stage_id
  FROM funnel_stages
  WHERE clinic_id = v_ticket.clinic_id AND slug = v_target_slug
  LIMIT 1;

  -- Atualiza ticket
  UPDATE tickets SET
    status = 'closed',
    outcome = p_outcome,
    outcome_at = now(),
    closed_at = COALESCE(closed_at, now()),
    loss_reason = CASE WHEN p_outcome = 'perdido' THEN p_loss_reason ELSE loss_reason END,
    notes = COALESCE(p_notes, notes),
    stage_id = COALESCE(v_target_stage_id, stage_id)
  WHERE id = p_ticket_id;

  -- Sincroniza lead na stage final
  IF v_ticket.lead_id IS NOT NULL AND v_target_stage_id IS NOT NULL THEN
    UPDATE leads SET stage_id = v_target_stage_id WHERE id = v_ticket.lead_id;

    BEGIN
      INSERT INTO lead_stage_history (clinic_id, lead_id, old_stage_id, new_stage_id, changed_at)
      VALUES (v_ticket.clinic_id, v_ticket.lead_id, v_old_stage_id, v_target_stage_id, now());
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'lead_id', v_ticket.lead_id,
    'outcome', p_outcome,
    'new_stage_id', v_target_stage_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_ticket(uuid, text, text, text) TO anon, authenticated, service_role;
