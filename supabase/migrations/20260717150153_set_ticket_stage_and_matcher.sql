-- 20260717150153_set_ticket_stage_and_matcher
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.normalize_stage_text(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT btrim(
    regexp_replace(
      lower(
        regexp_replace(
          regexp_replace(normalize(COALESCE(p_text, ''), NFD), E'[\\u0300-\\u036f]', '', 'g'),
          '[*_~`]', '', 'g'
        )
      ),
      '\s+', ' ', 'g'
    )
  );
$function$;

CREATE OR REPLACE FUNCTION public.match_stage_rule(p_clinic_id uuid, p_message text)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg    text;
  v_target uuid;
BEGIN
  v_msg := public.normalize_stage_text(p_message);
  IF v_msg = '' THEN RETURN NULL; END IF;

  SELECT r.target_stage_id INTO v_target
  FROM stage_transition_rules r
  WHERE r.clinic_id = p_clinic_id
    AND r.target_stage_id IS NOT NULL
    AND public.normalize_stage_text(r.keywords) <> ''
    AND position(public.normalize_stage_text(r.keywords) IN v_msg) > 0
  ORDER BY r.order_index NULLS LAST, r.created_at
  LIMIT 1;

  RETURN v_target;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_ticket_stage(
  p_ticket_id uuid,
  p_new_stage_id uuid,
  p_source text DEFAULT 'unknown',
  p_actor text DEFAULT NULL,
  p_on_resolved text DEFAULT 'new_cycle'
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket     RECORD;
  v_new_slug   text;
  v_new_ticket uuid;
  v_resolved   boolean;
BEGIN
  PERFORM set_config('app.stage_source', COALESCE(NULLIF(p_source, ''), 'unknown'), true);
  PERFORM set_config('app.stage_actor', COALESCE(p_actor, auth.uid()::text, ''), true);

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

  IF v_ticket.stage_id = p_new_stage_id THEN
    RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                              'new_stage_id', p_new_stage_id, 'new_cycle', false, 'noop', true);
  END IF;

  v_resolved := (v_ticket.outcome IS NOT NULL OR v_ticket.status = 'closed');

  IF v_resolved
     AND v_new_slug IS DISTINCT FROM 'ganho'
     AND v_new_slug IS DISTINCT FROM 'perdido' THEN

    IF p_on_resolved = 'block' THEN
      RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                                'blocked', true, 'reason', 'ticket_resolved');

    ELSIF p_on_resolved = 'new_cycle' THEN
      IF v_ticket.status <> 'closed' THEN
        UPDATE tickets SET status = 'closed', closed_at = COALESCE(closed_at, now())
        WHERE id = v_ticket.id;
      END IF;
      INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
      VALUES (v_ticket.clinic_id, v_ticket.lead_id, p_new_stage_id, 'open', now())
      RETURNING id INTO v_new_ticket;
      RETURN jsonb_build_object('success', true, 'ticket_id', v_new_ticket,
                                'previous_ticket_id', v_ticket.id,
                                'new_stage_id', p_new_stage_id, 'new_cycle', true);

    END IF;
  END IF;

  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;
  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                            'new_stage_id', p_new_stage_id, 'new_cycle', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_lead_stage(p_ticket_id uuid, p_new_stage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.set_ticket_stage(p_ticket_id, p_new_stage_id, 'kanban', NULL, 'new_cycle');
END;
$function$;

CREATE OR REPLACE FUNCTION public.move_ticket_keep_outcome(p_ticket_id uuid, p_new_stage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN public.set_ticket_stage(p_ticket_id, p_new_stage_id, 'kanban_keep', NULL, 'keep');
END;
$function$;
