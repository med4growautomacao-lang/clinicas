-- =============================================================================
-- Fase A0.3 — Agendar para lead já resolvido abre CICLO NOVO (não apaga venda)
--
-- fn_auto_move_lead_to_agendado zerava outcome/outcome_at ao mover o ticket
-- para 'agendado' — maior vetor de "des-ganho" silencioso (22 das 41 saídas de
-- Ganho). Paciente ganho que volta a agendar é o caso NORMAL de clínica.
--
-- Agora: ticket com outcome preenchido → fecha o ciclo antigo, abre ticket novo
-- em 'agendado' e RE-VINCULA a consulta ao ciclo novo (senão as mudanças de
-- status da consulta continuariam mexendo no ticket ganho antigo — o índice
-- appointments_one_active_per_ticket conta 'realizado' como ativo).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_to_agendado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket RECORD;
  v_target_stage_id uuid;
  v_new_ticket uuid;
BEGIN
  PERFORM set_config('app.stage_source', 'agenda', true);

  IF NEW.ticket_id IS NOT NULL THEN
    SELECT id, clinic_id, lead_id, stage_id, status, outcome INTO v_ticket
    FROM tickets WHERE id = NEW.ticket_id;
  ELSE
    SELECT t.id, t.clinic_id, t.lead_id, t.stage_id, t.status, t.outcome INTO v_ticket
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON normalize_br_phone(p.phone) = normalize_br_phone(l.phone) AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id AND t.status = 'open'
    LIMIT 1;
  END IF;
  IF v_ticket.id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_target_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado' LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  IF v_ticket.outcome IS NOT NULL THEN
    UPDATE tickets SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE id = v_ticket.id AND status <> 'closed';

    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (v_ticket.clinic_id, v_ticket.lead_id, v_target_stage_id, 'open', now())
    RETURNING id INTO v_new_ticket;

    UPDATE appointments SET ticket_id = v_new_ticket WHERE id = NEW.id;
  ELSE
    UPDATE tickets
      SET stage_id = v_target_stage_id
    WHERE id = v_ticket.id
      AND stage_id IS DISTINCT FROM v_target_stage_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Mesma origem de auditoria para o trigger de status da consulta
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

  PERFORM set_config('app.stage_source', 'agenda', true);

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
