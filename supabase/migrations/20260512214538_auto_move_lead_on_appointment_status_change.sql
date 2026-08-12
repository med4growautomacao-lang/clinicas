-- 20260512214538_auto_move_lead_on_appointment_status_change
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead_id uuid;
  v_target_slug text;
  v_target_stage_id uuid;
  v_target_position int;
  v_current_position int;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  -- Mapeia status → slug da etapa de destino
  v_target_slug := CASE NEW.status
    WHEN 'compareceu' THEN 'compareceu'
    WHEN 'realizado'  THEN 'ganho'
    WHEN 'cancelado'  THEN 'faltou_cancelou'
    WHEN 'faltou'     THEN 'faltou_cancelou'
    ELSE NULL
  END;

  IF v_target_slug IS NULL THEN RETURN NEW; END IF;

  -- Acha o lead via ticket (prioridade) ou via patient.phone → leads.phone
  IF NEW.ticket_id IS NOT NULL THEN
    SELECT lead_id INTO v_lead_id FROM tickets WHERE id = NEW.ticket_id;
  END IF;
  IF v_lead_id IS NULL THEN
    SELECT l.id INTO v_lead_id
    FROM leads l
    JOIN patients p ON p.phone = l.phone AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id
    LIMIT 1;
  END IF;
  IF v_lead_id IS NULL THEN RETURN NEW; END IF;

  -- Etapa de destino
  SELECT id, position INTO v_target_stage_id, v_target_position
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = v_target_slug
  LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  -- Posição atual do lead
  SELECT fs.position INTO v_current_position
  FROM leads l JOIN funnel_stages fs ON fs.id = l.stage_id
  WHERE l.id = v_lead_id;

  -- Regra: avança normalmente; cancelado/faltou pode ir mesmo se "retrocede"
  IF NEW.status IN ('cancelado', 'faltou')
     OR v_current_position IS NULL
     OR v_current_position < v_target_position THEN
    UPDATE leads SET stage_id = v_target_stage_id WHERE id = v_lead_id;

    -- Histórico
    BEGIN
      INSERT INTO lead_stage_history (clinic_id, lead_id, old_stage_id, new_stage_id, changed_at)
      VALUES (NEW.clinic_id, v_lead_id,
        (SELECT stage_id FROM funnel_stages WHERE position = v_current_position AND clinic_id = NEW.clinic_id LIMIT 1),
        v_target_stage_id, now());
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  -- Atualiza o ticket vinculado (se houver) para a mesma etapa
  IF NEW.ticket_id IS NOT NULL THEN
    UPDATE tickets
      SET stage_id = v_target_stage_id,
          outcome = CASE WHEN NEW.status = 'realizado' THEN 'ganho'
                         WHEN NEW.status IN ('cancelado', 'faltou') THEN 'perdido'
                         ELSE outcome END,
          outcome_at = CASE WHEN NEW.status IN ('realizado', 'cancelado', 'faltou') THEN now() ELSE outcome_at END
      WHERE id = NEW.ticket_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_move_lead_on_status_change_trg ON public.appointments;
CREATE TRIGGER auto_move_lead_on_status_change_trg
  AFTER UPDATE OF status ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_move_lead_on_status_change();
