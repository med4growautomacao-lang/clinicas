-- Invariante: mantém tickets.stage_id <-> tickets.outcome SEMPRE coerentes, em QUALQUER
-- caminho de escrita (arrastar, RPC, app, triggers automáticos). Fonte da verdade = outcome,
-- mas a "intenção" é quem o autor mudou nesta escrita:
--   * Mudou o OUTCOME explicitamente  -> outcome manda; alinha o estágio terminal.
--   * Mudou só o ESTÁGIO (arrastar)   -> estágio manda; deriva o outcome
--       (etapa 'ganho'/'perdido' => outcome correspondente; qualquer outra => reabre, outcome NULL).
-- Preserva: 'faltou_cancelou' (representa perdido, coluna própria) e o "limpar outcome ao reagendar"
-- (estágio=agendado + outcome=NULL na mesma escrita não dispara nenhuma regra).
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
    -- outcome explícito manda: alinhar estágio terminal
    IF NEW.outcome = 'ganho' AND v_slug IS DISTINCT FROM 'ganho' THEN
      SELECT id INTO v_term_stage_id FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = 'ganho' LIMIT 1;
      IF v_term_stage_id IS NOT NULL THEN NEW.stage_id := v_term_stage_id; END IF;
    ELSIF NEW.outcome = 'perdido' AND v_slug IS DISTINCT FROM 'perdido' AND v_slug IS DISTINCT FROM 'faltou_cancelou' THEN
      SELECT id INTO v_term_stage_id FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = 'perdido' LIMIT 1;
      IF v_term_stage_id IS NOT NULL THEN NEW.stage_id := v_term_stage_id; END IF;
    END IF;
    NEW.outcome_at := COALESCE(NEW.outcome_at, now());

  ELSIF v_stage_changed AND NOT v_outcome_changed THEN
    -- só o estágio mudou (arrastar): estágio manda, deriva outcome
    IF v_slug = 'ganho' THEN
      NEW.outcome := 'ganho';
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    ELSIF v_slug = 'perdido' THEN
      NEW.outcome := 'perdido';
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    ELSE
      -- voltou para etapa em andamento: reabre (sem resultado)
      NEW.outcome := NULL;
      NEW.outcome_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_enforce_ticket_resolution
  BEFORE INSERT OR UPDATE OF stage_id, outcome ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_ticket_resolution_consistency();
