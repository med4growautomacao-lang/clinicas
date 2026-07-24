-- Backend da auditoria do onboarding (bloco 3).
--
-- (A) Estende o interruptor de silêncio (app.onboarding_import='on') a 3 gatilhos de `tickets`
--     que ENVIAM/NOTIFICAM em desfecho/encerramento, para a auditoria de histórico não
--     mandar "encerramento" ao paciente nem pingar "Venda 🎉" ao marcar atendimento antigo.
--     Fora da flag = comportamento idêntico (a condição extra é sempre verdadeira).
-- (B) RPC onboarding_audit_apply: aplica a decisão de auditoria de um lead da Sincronização.

-- (A1) Venda (fire em INSERT do ticket ganho)
DROP TRIGGER IF EXISTS trg_notify_venda ON public.tickets;
CREATE TRIGGER trg_notify_venda AFTER INSERT OR UPDATE OF outcome ON public.tickets
  FOR EACH ROW
  WHEN (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  EXECUTE FUNCTION fn_notify_venda();

-- (A2) Mensagem de encerramento ao paciente (fire ao fechar/ganho/perdido)
DROP TRIGGER IF EXISTS trg_ticket_finish_message ON public.tickets;
CREATE TRIGGER trg_ticket_finish_message AFTER UPDATE ON public.tickets
  FOR EACH ROW
  WHEN (
    (
      ((new.outcome IS DISTINCT FROM old.outcome) AND (new.outcome = ANY (ARRAY['ganho'::text, 'perdido'::text])))
      OR ((new.status IS DISTINCT FROM old.status) AND (new.status = 'closed'::text))
    )
    AND (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  )
  EXECUTE FUNCTION fn_ticket_finish_message();

-- (A3) Notificação de encerramento ganho (ops)
DROP TRIGGER IF EXISTS trg_notify_encerramento_ganho ON public.tickets;
CREATE TRIGGER trg_notify_encerramento_ganho AFTER UPDATE ON public.tickets
  FOR EACH ROW
  WHEN (coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  EXECUTE FUNCTION fn_notify_encerramento_ganho();

-- (B) RPC
CREATE OR REPLACE FUNCTION public.onboarding_audit_apply(
  p_ticket_id        uuid,
  p_not_patient      boolean DEFAULT false,
  p_in_conversation  boolean DEFAULT false,
  p_last_appt_date   date    DEFAULT NULL,
  p_resolve_past     boolean DEFAULT true,
  p_next_appt_date   date    DEFAULT NULL,
  p_ai_enabled       boolean DEFAULT false,
  p_followup_enabled boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead      uuid;
  v_clinic    uuid;
  v_status    text;
  v_ganho     uuid;
  v_agendado  uuid;
  v_wa        uuid;
  v_past_status text;
  v_past_ticket uuid;
  v_action    text;
BEGIN
  SELECT lead_id, clinic_id, status INTO v_lead, v_clinic, v_status
    FROM tickets WHERE id = p_ticket_id;
  IF v_lead IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  IF NOT (is_super_admin() OR is_clinic_admin(v_clinic)) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  -- interruptor de silêncio + autoria de etapa (evita warning de "rogue stage update")
  PERFORM set_config('app.onboarding_import', 'on', true);
  PERFORM set_config('app.stage_source', 'onboarding', true);

  -- 1) Não é paciente (exclusivo): tira das métricas, desliga tudo, fecha o ticket.
  IF p_not_patient THEN
    UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false,
           not_lead_at = now() WHERE id = v_lead;
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now())
     WHERE id = p_ticket_id AND status <> 'closed';
    RETURN jsonb_build_object('success', true, 'action', 'not_patient', 'lead_id', v_lead);
  END IF;

  -- Conflito: passado NÃO resolvido não pode coexistir com futuro/conversa (2 tickets abertos).
  IF p_last_appt_date IS NOT NULL AND NOT p_resolve_past
     AND (p_next_appt_date IS NOT NULL OR p_in_conversation) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'resolve_past_required_with_open_current');
  END IF;

  UPDATE leads SET ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled,
         is_not_lead = false WHERE id = v_lead;

  -- Passado aberto só quando não há futuro/conversa e o usuário optou por não resolver.
  v_past_status := CASE
    WHEN p_last_appt_date IS NULL THEN NULL
    WHEN (p_next_appt_date IS NOT NULL OR p_in_conversation) THEN 'closed'
    WHEN p_resolve_past THEN 'closed'
    ELSE 'open'
  END;

  -- Se o passado vai ficar ABERTO, ele assume a vaga do único ticket aberto:
  -- fecha o ticket da Sincronização ANTES de inserir (respeita uq_tickets_one_open_per_lead).
  IF v_past_status = 'open' THEN
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now())
     WHERE id = p_ticket_id AND status <> 'closed';
  END IF;

  -- 2) Passado -> ticket ganho retroativo (fn_notify_venda está guardado; finish_message é UPDATE, não dispara em INSERT).
  IF p_last_appt_date IS NOT NULL THEN
    SELECT id INTO v_ganho FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'ganho' LIMIT 1;
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, outcome, opened_at, closed_at, outcome_at, notes)
    VALUES (v_clinic, v_lead, v_ganho, v_past_status, 'ganho',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            CASE WHEN v_past_status = 'closed' THEN (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo' END,
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY') || ' (onboarding)')
    RETURNING id INTO v_past_ticket;
  END IF;

  -- 3) Destino do ticket da Sincronização (o "atual") — só se ainda aberto.
  IF EXISTS (SELECT 1 FROM tickets WHERE id = p_ticket_id AND status = 'open') THEN
    IF p_next_appt_date IS NOT NULL THEN
      SELECT id INTO v_agendado FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'agendado' LIMIT 1;
      UPDATE tickets SET stage_id = v_agendado,
             notes = 'Próximo agendamento em ' || to_char(p_next_appt_date, 'DD/MM/YYYY') || ' (onboarding)'
       WHERE id = p_ticket_id;
      v_action := 'agendado';
    ELSIF p_in_conversation THEN
      SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;
      UPDATE tickets SET stage_id = v_wa WHERE id = p_ticket_id;
      v_action := 'em_conversa';
    ELSIF p_last_appt_date IS NOT NULL AND v_past_status = 'closed' THEN
      -- só um atendimento passado resolvido, sem atividade atual: fecha o ticket da Sincronização.
      UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id;
      v_action := 'passado_resolvido';
    ELSE
      v_action := 'mantido_na_sincronizacao';
    END IF;
  ELSE
    v_action := 'passado_aberto';
  END IF;

  RETURN jsonb_build_object('success', true, 'action', v_action, 'lead_id', v_lead,
    'past_ticket', v_past_ticket, 'past_status', v_past_status);

EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-audit', 'audit_apply_failed',
    'Falha ao aplicar auditoria de onboarding', 'error', v_clinic,
    jsonb_build_object('ticket_id', p_ticket_id, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END;
$function$;

REVOKE ALL ON FUNCTION public.onboarding_audit_apply(uuid, boolean, boolean, date, boolean, date, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_audit_apply(uuid, boolean, boolean, date, boolean, date, boolean, boolean) TO authenticated;
