-- Rollback de 20260706000003_enforce_conversion_follows_ganho.sql
DROP TRIGGER IF EXISTS trg_ticket_left_ganho ON public.tickets;
DROP FUNCTION IF EXISTS public.fn_ticket_left_ganho();
DROP FUNCTION IF EXISTS public.fn_purge_ticket_sale(uuid);

-- Restaura fn_enforce_ticket_resolution_consistency SEM a linha NEW.loss_reason := NULL
CREATE OR REPLACE FUNCTION public.fn_enforce_ticket_resolution_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
  v_stage_changed boolean;
  v_outcome_changed boolean;
  v_term_stage_id uuid;
BEGIN
  SELECT slug INTO v_slug FROM funnel_stages WHERE id = NEW.stage_id;

  IF TG_OP = 'INSERT' THEN
    v_stage_changed := true;
    v_outcome_changed := (NEW.outcome IS NOT NULL);
  ELSE
    v_stage_changed := NEW.stage_id IS DISTINCT FROM OLD.stage_id;
    v_outcome_changed := NEW.outcome IS DISTINCT FROM OLD.outcome;
  END IF;

  IF v_outcome_changed AND NEW.outcome IS NOT NULL THEN
    IF NEW.outcome = 'ganho' AND v_slug IS DISTINCT FROM 'ganho' THEN
      SELECT id INTO v_term_stage_id FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = 'ganho' LIMIT 1;
      IF v_term_stage_id IS NOT NULL THEN NEW.stage_id := v_term_stage_id; END IF;
    ELSIF NEW.outcome = 'perdido' AND v_slug IS DISTINCT FROM 'perdido' AND v_slug IS DISTINCT FROM 'faltou_cancelou' THEN
      SELECT id INTO v_term_stage_id FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = 'perdido' LIMIT 1;
      IF v_term_stage_id IS NOT NULL THEN NEW.stage_id := v_term_stage_id; END IF;
    END IF;
    NEW.outcome_at := COALESCE(NEW.outcome_at, now());
  ELSIF v_stage_changed AND NOT v_outcome_changed THEN
    IF v_slug = 'ganho' THEN
      NEW.outcome := 'ganho';
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    ELSIF v_slug = 'perdido' THEN
      NEW.outcome := 'perdido';
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    ELSE
      NEW.outcome := NULL;
      NEW.outcome_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
