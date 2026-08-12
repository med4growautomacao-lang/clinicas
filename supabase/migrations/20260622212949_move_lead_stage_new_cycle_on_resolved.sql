-- 20260622212949_move_lead_stage_new_cycle_on_resolved
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.move_lead_stage(p_ticket_id uuid, p_new_stage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket      RECORD;
  v_new_slug    text;
  v_new_ticket  uuid;
BEGIN
  SELECT id, lead_id, stage_id, clinic_id, status, outcome
    INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF v_new_slug IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  -- NOVO CICLO: ticket já resolvido (ganho/perdido) recebendo gatilho de etapa ATIVA.
  IF (v_ticket.outcome IS NOT NULL OR v_ticket.status = 'closed')
     AND v_new_slug NOT IN ('ganho', 'perdido') THEN

    -- fecha o ticket resolvido se ainda estiver aberto (mantém 1 ticket aberto por lead)
    IF v_ticket.status <> 'closed' THEN
      UPDATE tickets
        SET status = 'closed', closed_at = COALESCE(closed_at, now())
        WHERE id = v_ticket.id;
    END IF;

    -- abre o ticket do novo ciclo já na etapa-alvo
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (v_ticket.clinic_id, v_ticket.lead_id, p_new_stage_id, 'open', now())
    RETURNING id INTO v_new_ticket;

    RETURN jsonb_build_object(
      'success', true,
      'ticket_id', v_new_ticket,
      'previous_ticket_id', v_ticket.id,
      'new_stage_id', p_new_stage_id,
      'new_cycle', true
    );
  END IF;

  -- comportamento normal
  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'new_stage_id', p_new_stage_id,
    'new_cycle', false
  );
END;
$function$;
