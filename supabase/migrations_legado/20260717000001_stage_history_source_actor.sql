-- =============================================================================
-- Fase A0.1 — Auditoria de origem nas mudanças de etapa
--
-- lead_stage_history não registrava QUEM moveu o ticket (41 saídas da etapa
-- Ganho em 14 clínicas, nenhuma atribuível). Todo escritor passa a declarar a
-- origem via GUC de transação (app.stage_source / app.stage_actor); o logger
-- grava com fallback 'unknown' = escritor ainda não sancionado (UPDATE cru).
-- =============================================================================

ALTER TABLE public.lead_stage_history
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS actor text;

CREATE OR REPLACE FUNCTION public.fn_log_ticket_stage_change()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    INSERT INTO lead_stage_history (clinic_id, lead_id, ticket_id, old_stage_id, new_stage_id, changed_at, source, actor)
    VALUES (NEW.clinic_id, NEW.lead_id, NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END,
            NEW.stage_id, (now() AT TIME ZONE 'America/Sao_Paulo'),
            COALESCE(NULLIF(current_setting('app.stage_source', true), ''), 'unknown'),
            NULLIF(current_setting('app.stage_actor', true), ''));
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- RPCs sancionadas declaram a origem (GUC local à transação)
-- ---------------------------------------------------------------------------

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

    RETURN jsonb_build_object(
      'success', true,
      'ticket_id', v_new_ticket,
      'previous_ticket_id', v_ticket.id,
      'new_stage_id', p_new_stage_id,
      'new_cycle', true
    );
  END IF;

  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'new_stage_id', p_new_stage_id,
    'new_cycle', false
  );
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

CREATE OR REPLACE FUNCTION public.finalize_ticket(p_ticket_id uuid, p_outcome text, p_loss_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_resolve boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket RECORD;
  v_target_stage_id uuid;
BEGIN
  PERFORM set_config('app.stage_source', 'finalize', true);
  PERFORM set_config('app.stage_actor', COALESCE(auth.uid()::text, ''), true);

  IF p_outcome NOT IN ('ganho', 'perdido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_outcome');
  END IF;

  SELECT id, lead_id, stage_id, clinic_id INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT id INTO v_target_stage_id FROM funnel_stages
  WHERE clinic_id = v_ticket.clinic_id AND slug = p_outcome LIMIT 1;

  UPDATE tickets SET
    status      = CASE WHEN p_resolve THEN 'closed' ELSE status END,
    closed_at   = CASE WHEN p_resolve THEN COALESCE(closed_at, now()) ELSE closed_at END,
    outcome     = p_outcome,
    outcome_at  = now(),
    loss_reason = CASE WHEN p_outcome = 'perdido' THEN p_loss_reason ELSE loss_reason END,
    notes       = COALESCE(p_notes, notes),
    stage_id    = COALESCE(v_target_stage_id, stage_id)
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'lead_id', v_ticket.lead_id,
    'outcome', p_outcome,
    'resolved', p_resolve,
    'new_stage_id', v_target_stage_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_move_forms_to_whatsapp_on_inbound()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_whatsapp_stage_id uuid;
BEGIN
  IF NEW.direction <> 'inbound' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_whatsapp_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'whatsapp'
  LIMIT 1;

  IF v_whatsapp_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.stage_source', 'inbound', true);

  UPDATE tickets t
  SET stage_id = v_whatsapp_stage_id
  WHERE t.lead_id = NEW.lead_id
    AND t.status = 'open'
    AND t.stage_id IN (
      SELECT id FROM funnel_stages
      WHERE clinic_id = NEW.clinic_id
        AND slug IN ('forms', 'sincronizacao')
    );

  RETURN NEW;
END;
$function$;
