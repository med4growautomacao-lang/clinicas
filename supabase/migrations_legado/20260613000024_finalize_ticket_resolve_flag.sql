-- Estende finalize_ticket com p_resolve: permite gravar o RESULTADO (outcome + estágio terminal)
-- SEM necessariamente encerrar (status='closed'). Assim o frontend deixa de fazer UPDATE direto
-- em tickets.outcome (closeTicket) e passa por esta RPC atômica.
--   p_resolve = false  -> só marca outcome/estágio (card continua aberto no Kanban). [Ganho/Perdido]
--   p_resolve = true   -> também encerra o atendimento (status='closed').
DROP FUNCTION IF EXISTS public.finalize_ticket(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.finalize_ticket(
  p_ticket_id uuid,
  p_outcome text,
  p_loss_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_resolve boolean DEFAULT true
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket RECORD;
  v_target_stage_id uuid;
BEGIN
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

GRANT EXECUTE ON FUNCTION public.finalize_ticket(uuid, text, text, text, boolean) TO authenticated;
