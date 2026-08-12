-- Ticket órfão (lead_id NULL) não gera "novo ciclo".
--
-- O caminho new_cycle copiava v_ticket.lead_id para o ticket novo. Quando o ticket de origem já
-- era órfão, o filho nascia órfão também — e o ciclo se repetia a cada gatilho de etapa. Foi o
-- multiplicador por trás dos 242 órfãos de 22/07: 120 "pais" (leads apagadas pelo bug do botão
-- Excluir, que ainda tinham lead_phone) geraram 122 "filhos" (sem lead_phone, porque
-- fn_set_ticket_lead_phone só preenche quando há lead). Só a Gheller acumulou 68.
--
-- Com lead_id NULL o ticket é lixo: não faz sentido abrir um ciclo novo para ele. Cai no UPDATE
-- normal de etapa (move o próprio ticket) em vez de multiplicar.
CREATE OR REPLACE FUNCTION public.set_ticket_stage(p_ticket_id uuid, p_new_stage_id uuid, p_source text DEFAULT 'unknown'::text, p_actor text DEFAULT NULL::text, p_on_resolved text DEFAULT 'new_cycle'::text)
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
     AND v_ticket.lead_id IS NOT NULL   -- órfão não se reproduz (ver comentário no topo)
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

-- Limpeza dos 243 órfãos existentes (backup em public._orphan_tickets_backup_20260722):
--   delete from tickets where lead_id is null;
-- Verificado antes: 0 conversões, 0 mensagens, 0 orçamentos/OPs/CRM vinculados; as 15 consultas
-- ligadas eram todas passadas e permanecem na agenda (appointments.ticket_id é SET NULL).
