-- A etapa do lead vive no ticket aberto (tickets.stage_id), nao em leads.stage_id (deprecado).
-- O trigger de follow-up esgotado escrevia leads.stage_id, sem efeito no funil.
-- Agora move o ticket aberto, disparando trg_log_ticket_stage_change (historico + funil).
CREATE OR REPLACE FUNCTION public.fn_check_followup_exhausted()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_max_attempts int;
  v_perdido_id uuid;
BEGIN
  IF NEW.followup_count = OLD.followup_count THEN RETURN NEW; END IF;
  SELECT followup_max_attempts INTO v_max_attempts FROM public.ai_config WHERE clinic_id = NEW.clinic_id LIMIT 1;
  IF v_max_attempts IS NULL OR NEW.followup_count < v_max_attempts THEN RETURN NEW; END IF;
  SELECT id INTO v_perdido_id FROM public.funnel_stages WHERE clinic_id = NEW.clinic_id AND name = 'Perdido' LIMIT 1;
  IF v_perdido_id IS NOT NULL THEN
    UPDATE public.tickets
      SET stage_id = v_perdido_id
      WHERE lead_id = NEW.id
        AND status = 'open'
        AND stage_id IS DISTINCT FROM v_perdido_id;
    NEW.loss_reason := 'Tentativas de follow-up esgotadas';
  END IF;
  RETURN NEW;
END;
$function$;
