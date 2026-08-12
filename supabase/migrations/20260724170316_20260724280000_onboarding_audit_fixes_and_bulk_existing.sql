-- 20260724170316_20260724280000_onboarding_audit_fixes_and_bulk_existing
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Correções da auditoria de onboarding:
--  #3 lead_perdido passa a LIGAR a IA ("sempre ative IA ao resolver": perdido é a oportunidade, não a pessoa).
--  #5 todos os stage_id com COALESCE (clínica sem a etapa não gera ticket com stage nulo, que some do Kanban).
CREATE OR REPLACE FUNCTION public.onboarding_audit_apply(p_ticket_id uuid, p_category text, p_last_appt_date date DEFAULT NULL::date, p_resolve_past boolean DEFAULT true, p_next_appt_date date DEFAULT NULL::date, p_ai_enabled boolean DEFAULT true, p_followup_enabled boolean DEFAULT true, p_scheduled boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid; v_clinic uuid; v_ganho uuid; v_agendado uuid; v_wa uuid; v_perdido uuid; v_sinc uuid;
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
  UPDATE leads SET onboarding_reviewed_at = now() WHERE id = v_lead;

  IF p_scheduled THEN
    IF p_category = 'contato_geral' THEN
      UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false, not_lead_at = now() WHERE id = v_lead;
    ELSE
      UPDATE leads SET is_not_lead = false, ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled WHERE id = v_lead;
    END IF;
    RETURN jsonb_build_object('success', true, 'action', 'scheduled_' || p_category, 'lead_id', v_lead);
  END IF;

  DELETE FROM tickets WHERE lead_id = v_lead AND id <> p_ticket_id AND coalesce(notes,'') LIKE '%(onboarding)%';
  SELECT id INTO v_sinc FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'sincronizacao' LIMIT 1;
  UPDATE tickets SET status='open', closed_at=NULL, outcome=NULL, outcome_at=NULL, loss_reason=NULL,
         stage_id=coalesce(v_sinc, stage_id), notes=NULL WHERE id = p_ticket_id;

  IF p_category = 'contato_geral' THEN
    UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false, not_lead_at = now() WHERE id = v_lead;
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id AND status <> 'closed';
    RETURN jsonb_build_object('success', true, 'action', 'contato_geral', 'lead_id', v_lead);
  END IF;

  IF p_category = 'lead_perdido' THEN
    -- Resolver SEMPRE liga a IA: o lead pode voltar e comprar; perdido é só aquela oportunidade.
    UPDATE leads SET is_not_lead = false, ai_enabled = true, followup_enabled = false WHERE id = v_lead;
    SELECT id INTO v_perdido FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'perdido' LIMIT 1;
    UPDATE tickets SET outcome = 'perdido', outcome_at = now(), status = 'closed', closed_at = coalesce(closed_at, now()),
           stage_id = coalesce(v_perdido, stage_id), loss_reason = coalesce(loss_reason, 'Onboarding') WHERE id = p_ticket_id;
    RETURN jsonb_build_object('success', true, 'action', 'lead_perdido', 'lead_id', v_lead);
  END IF;

  UPDATE leads SET is_not_lead = false, ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled WHERE id = v_lead;

  IF p_category = 'lead_potencial' THEN
    SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;
    UPDATE tickets SET stage_id = coalesce(v_wa, stage_id) WHERE id = p_ticket_id AND status = 'open';
    RETURN jsonb_build_object('success', true, 'action', 'lead_potencial', 'lead_id', v_lead);
  END IF;

  IF p_last_appt_date IS NOT NULL AND NOT p_resolve_past AND p_next_appt_date IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'resolve_past_required_with_open_current');
  END IF;
  v_past_status := CASE WHEN p_last_appt_date IS NULL THEN NULL
    WHEN p_next_appt_date IS NOT NULL THEN 'closed' WHEN p_resolve_past THEN 'closed' ELSE 'open' END;
  IF v_past_status = 'open' THEN
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id AND status <> 'closed';
  END IF;
  IF p_last_appt_date IS NOT NULL THEN
    SELECT id INTO v_ganho FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'ganho' LIMIT 1;
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, outcome, opened_at, closed_at, outcome_at, notes)
    VALUES (v_clinic, v_lead, coalesce(v_ganho, v_sinc), v_past_status, 'ganho',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            CASE WHEN v_past_status = 'closed' THEN (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo' END,
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY') || ' (onboarding)')
    RETURNING id INTO v_past_ticket;
  END IF;
  IF EXISTS (SELECT 1 FROM tickets WHERE id = p_ticket_id AND status = 'open') THEN
    IF p_next_appt_date IS NOT NULL THEN
      SELECT id INTO v_agendado FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'agendado' LIMIT 1;
      UPDATE tickets SET stage_id = coalesce(v_agendado, stage_id),
             notes = 'Próximo agendamento em ' || to_char(p_next_appt_date, 'DD/MM/YYYY') || ' (onboarding)' WHERE id = p_ticket_id;
      v_action := 'paciente_agendado';
    ELSIF p_last_appt_date IS NOT NULL AND v_past_status = 'closed' THEN
      UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id;
      v_action := 'paciente_passado';
    ELSE
      SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;
      UPDATE tickets SET stage_id = coalesce(v_wa, stage_id) WHERE id = p_ticket_id;
      v_action := 'paciente_ativo';
    END IF;
  ELSE v_action := 'paciente_passado_aberto'; END IF;

  RETURN jsonb_build_object('success', true, 'action', v_action, 'lead_id', v_lead, 'past_ticket', v_past_ticket);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-audit', 'audit_apply_failed', 'Falha ao aplicar auditoria de onboarding', 'error',
    v_clinic, jsonb_build_object('ticket_id', p_ticket_id, 'category', p_category, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END; $function$;

-- #4 Confirmação em lote dos clientes EXISTENTES (mesma seleção Tipo B do onboarding_pending_leads).
-- Aplica o padrão (paciente, IA/follow-up OFF por padrão) sem tocar no ticket ganho/agendado. Idempotente.
CREATE OR REPLACE FUNCTION public.onboarding_confirm_all_existing(p_clinic_id uuid, p_ai boolean DEFAULT false, p_followup boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_stage uuid; v_months integer; v_cutoff timestamp; v_count int;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  SELECT onboarding_period_months INTO v_months FROM clinics WHERE id = p_clinic_id;
  v_cutoff := CASE WHEN v_months IS NULL THEN '1900-01-01'::timestamp
                   ELSE (now() AT TIME ZONE 'America/Sao_Paulo') - (v_months || ' months')::interval END;
  PERFORM set_config('app.onboarding_import', 'on', true);

  WITH tgt AS (
    SELECT l.id FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND l.created_at >= v_cutoff
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id)
      AND (v_stage IS NULL OR NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.stage_id = v_stage AND tk.status = 'open'))
      AND (
        EXISTS (SELECT 1 FROM appointments a JOIN patients p ON p.id = a.patient_id
                WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
                  AND a.status NOT IN ('cancelado','faltou'))
        OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.outcome = 'ganho')
      )
  )
  UPDATE leads SET is_not_lead = false, ai_enabled = p_ai, followup_enabled = p_followup, onboarding_reviewed_at = now()
  WHERE id IN (SELECT id FROM tgt);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'count', v_count);
END; $function$;
