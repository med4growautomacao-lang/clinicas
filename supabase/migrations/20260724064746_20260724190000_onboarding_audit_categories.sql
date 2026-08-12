-- 20260724064746_20260724190000_onboarding_audit_categories
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Auditoria por CATEGORIA (novo contrato da tela): contato_geral | lead_potencial | lead_perdido | paciente.
-- IA/followup passam a vir LIGADOS por padrão. Inclui o caminho "perdido".
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, boolean, boolean, date, boolean, date, boolean, boolean);

CREATE OR REPLACE FUNCTION public.onboarding_audit_apply(
  p_ticket_id        uuid,
  p_category         text,
  p_last_appt_date   date    DEFAULT NULL,
  p_resolve_past     boolean DEFAULT true,
  p_next_appt_date   date    DEFAULT NULL,
  p_ai_enabled       boolean DEFAULT true,
  p_followup_enabled boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid; v_clinic uuid; v_ganho uuid; v_agendado uuid; v_wa uuid; v_perdido uuid;
  v_past_status text; v_past_ticket uuid; v_action text;
BEGIN
  SELECT lead_id, clinic_id INTO v_lead, v_clinic FROM tickets WHERE id = p_ticket_id;
  IF v_lead IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found'); END IF;
  IF NOT fn_can_onboard(v_clinic) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF p_category NOT IN ('contato_geral','lead_potencial','lead_perdido','paciente') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_category');
  END IF;

  PERFORM set_config('app.onboarding_import', 'on', true);
  PERFORM set_config('app.stage_source', 'onboarding', true);

  -- CONTATO GERAL: não é lead/paciente -> lista "não lead", desliga tudo, fecha ticket.
  IF p_category = 'contato_geral' THEN
    UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false, not_lead_at = now() WHERE id = v_lead;
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id AND status <> 'closed';
    RETURN jsonb_build_object('success', true, 'action', 'contato_geral', 'lead_id', v_lead);
  END IF;

  -- LEAD PERDIDO: desfecho perdido, ticket fechado.
  IF p_category = 'lead_perdido' THEN
    UPDATE leads SET is_not_lead = false, ai_enabled = false, followup_enabled = false WHERE id = v_lead;
    SELECT id INTO v_perdido FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'perdido' LIMIT 1;
    UPDATE tickets SET outcome = 'perdido', outcome_at = now(), status = 'closed', closed_at = coalesce(closed_at, now()),
           stage_id = coalesce(v_perdido, stage_id), loss_reason = coalesce(loss_reason, 'Onboarding')
     WHERE id = p_ticket_id;
    RETURN jsonb_build_object('success', true, 'action', 'lead_perdido', 'lead_id', v_lead);
  END IF;

  -- A partir daqui: LEAD POTENCIAL ou PACIENTE (mantêm o lead ativo, ai/followup conforme escolha).
  UPDATE leads SET is_not_lead = false, ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled WHERE id = v_lead;

  -- LEAD POTENCIAL: conversa ativa -> etapa WhatsApp.
  IF p_category = 'lead_potencial' THEN
    SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;
    UPDATE tickets SET stage_id = v_wa WHERE id = p_ticket_id AND status = 'open';
    RETURN jsonb_build_object('success', true, 'action', 'lead_potencial', 'lead_id', v_lead);
  END IF;

  -- PACIENTE (novo ou antigo): datas de atendimento.
  IF p_last_appt_date IS NOT NULL AND NOT p_resolve_past AND p_next_appt_date IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'resolve_past_required_with_open_current');
  END IF;

  v_past_status := CASE
    WHEN p_last_appt_date IS NULL THEN NULL
    WHEN p_next_appt_date IS NOT NULL THEN 'closed'
    WHEN p_resolve_past THEN 'closed' ELSE 'open' END;

  IF v_past_status = 'open' THEN
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id AND status <> 'closed';
  END IF;

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

  IF EXISTS (SELECT 1 FROM tickets WHERE id = p_ticket_id AND status = 'open') THEN
    IF p_next_appt_date IS NOT NULL THEN
      SELECT id INTO v_agendado FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'agendado' LIMIT 1;
      UPDATE tickets SET stage_id = v_agendado,
             notes = 'Próximo agendamento em ' || to_char(p_next_appt_date, 'DD/MM/YYYY') || ' (onboarding)' WHERE id = p_ticket_id;
      v_action := 'paciente_agendado';
    ELSIF p_last_appt_date IS NOT NULL AND v_past_status = 'closed' THEN
      UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id;
      v_action := 'paciente_passado';
    ELSE
      SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;
      UPDATE tickets SET stage_id = v_wa WHERE id = p_ticket_id;
      v_action := 'paciente_ativo';
    END IF;
  ELSE
    v_action := 'paciente_passado_aberto';
  END IF;

  RETURN jsonb_build_object('success', true, 'action', v_action, 'lead_id', v_lead, 'past_ticket', v_past_ticket);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-audit', 'audit_apply_failed', 'Falha ao aplicar auditoria de onboarding', 'error',
    v_clinic, jsonb_build_object('ticket_id', p_ticket_id, 'category', p_category, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END;
$function$;

REVOKE ALL ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean) TO authenticated;
