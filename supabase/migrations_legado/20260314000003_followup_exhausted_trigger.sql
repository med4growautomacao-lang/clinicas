-- ============================================
-- Trigger: move lead para "Perdido" ao esgotar
-- tentativas de follow-up
-- ============================================

CREATE OR REPLACE FUNCTION public.fn_check_followup_exhausted()
RETURNS TRIGGER AS $$
DECLARE
  v_max_attempts int;
  v_perdido_id   uuid;
BEGIN
  -- Ignora se followup_count não mudou
  IF NEW.followup_count = OLD.followup_count THEN
    RETURN NEW;
  END IF;

  -- Busca o limite configurado para a clínica
  SELECT followup_max_attempts INTO v_max_attempts
  FROM public.ai_config
  WHERE clinic_id = NEW.clinic_id
  LIMIT 1;

  -- Se ainda não atingiu o limite, não faz nada
  IF v_max_attempts IS NULL OR NEW.followup_count < v_max_attempts THEN
    RETURN NEW;
  END IF;

  -- Busca o estágio "Perdido" da clínica
  SELECT id INTO v_perdido_id
  FROM public.funnel_stages
  WHERE clinic_id = NEW.clinic_id
    AND name = 'Perdido'
  LIMIT 1;

  -- Move o lead e registra o motivo
  IF v_perdido_id IS NOT NULL AND (NEW.stage_id IS DISTINCT FROM v_perdido_id) THEN
    NEW.stage_id   := v_perdido_id;
    NEW.loss_reason := 'Tentativas de follow-up esgotadas';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_followup_exhausted ON public.leads;

CREATE TRIGGER trg_followup_exhausted
  BEFORE UPDATE OF followup_count ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_check_followup_exhausted();
