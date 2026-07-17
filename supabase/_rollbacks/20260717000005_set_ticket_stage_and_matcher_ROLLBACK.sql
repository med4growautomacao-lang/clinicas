-- Rollback da 20260717000005_set_ticket_stage_and_matcher
-- Restaura move_lead_stage / move_ticket_keep_outcome como funções autônomas
-- (versão da migration 20260717000001, com GUC próprio) e remove as funções novas.
-- NOTA: só é seguro rodar este rollback se a Fase A2 (trigger) e A3 (IA) NÃO
-- estiverem usando set_ticket_stage/match_stage_rule.

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
  PERFORM set_config('app.stage_source', 'kanban', true);
  PERFORM set_config('app.stage_actor', COALESCE(auth.uid()::text, ''), true);

  SELECT id, lead_id, stage_id, clinic_id, status, outcome
    INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  IF (v_ticket.outcome IS NOT NULL OR v_ticket.status = 'closed')
     AND v_new_slug IS DISTINCT FROM 'ganho'
     AND v_new_slug IS DISTINCT FROM 'perdido' THEN

    IF v_ticket.status <> 'closed' THEN
      UPDATE tickets
        SET status = 'closed', closed_at = COALESCE(closed_at, now())
        WHERE id = v_ticket.id;
    END IF;

    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (v_ticket.clinic_id, v_ticket.lead_id, p_new_stage_id, 'open', now())
    RETURNING id INTO v_new_ticket;

    RETURN jsonb_build_object('success', true, 'ticket_id', v_new_ticket,
      'previous_ticket_id', v_ticket.id, 'new_stage_id', p_new_stage_id, 'new_cycle', true);
  END IF;

  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;
  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
    'new_stage_id', p_new_stage_id, 'new_cycle', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_ticket_keep_outcome(p_ticket_id uuid, p_new_stage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_slug text;
BEGIN
  PERFORM set_config('app.stage_source', 'kanban_keep', true);
  PERFORM set_config('app.stage_actor', COALESCE(auth.uid()::text, ''), true);

  IF NOT EXISTS (SELECT 1 FROM tickets WHERE id = p_ticket_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  PERFORM set_config('app.keep_ticket_outcome', 'on', true);
  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;
  PERFORM set_config('app.keep_ticket_outcome', 'off', true);

  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id, 'new_stage_id', p_new_stage_id);
END;
$function$;

DROP FUNCTION IF EXISTS public.set_ticket_stage(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.match_stage_rule(uuid, text);
DROP FUNCTION IF EXISTS public.normalize_stage_text(text);
