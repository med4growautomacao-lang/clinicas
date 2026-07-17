-- Rollback da 20260717000003_agendado_new_cycle
-- Restaura o comportamento anterior: mover o ticket para 'agendado' ZERANDO
-- outcome/outcome_at (vetor de des-ganho conhecido) e o trigger de status sem
-- GUC de auditoria.

CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_to_agendado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_target_stage_id uuid;
BEGIN
  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    SELECT t.id INTO v_ticket_id
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON normalize_br_phone(p.phone) = normalize_br_phone(l.phone) AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id AND t.status = 'open'
    LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_target_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado' LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  UPDATE tickets
    SET stage_id = v_target_stage_id,
        outcome = NULL,
        outcome_at = NULL
  WHERE id = v_ticket_id
    AND stage_id IS DISTINCT FROM v_target_stage_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_target_slug text;
  v_target_stage_id uuid;
  v_target_position int;
  v_current_position int;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  v_target_slug := CASE NEW.status
    WHEN 'compareceu' THEN 'compareceu'
    WHEN 'realizado'  THEN 'ganho'
    WHEN 'cancelado'  THEN 'faltou_cancelou'
    WHEN 'faltou'     THEN 'faltou_cancelou'
    ELSE NULL
  END;
  IF v_target_slug IS NULL THEN RETURN NEW; END IF;

  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    SELECT t.id INTO v_ticket_id
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON p.phone = l.phone AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id
    ORDER BY (t.status = 'open') DESC, t.opened_at DESC
    LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, position INTO v_target_stage_id, v_target_position
  FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = v_target_slug LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  SELECT fs.position INTO v_current_position
  FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
  WHERE t.id = v_ticket_id;

  IF NEW.status IN ('cancelado', 'faltou')
     OR v_current_position IS NULL
     OR v_current_position < v_target_position THEN
    UPDATE tickets
      SET stage_id = v_target_stage_id,
          outcome = CASE WHEN NEW.status = 'realizado' THEN 'ganho'
                         WHEN NEW.status IN ('cancelado', 'faltou') THEN 'perdido'
                         ELSE outcome END,
          outcome_at = CASE WHEN NEW.status IN ('realizado', 'cancelado', 'faltou') THEN now() ELSE outcome_at END
      WHERE id = v_ticket_id;
  END IF;

  RETURN NEW;
END;
$function$;
