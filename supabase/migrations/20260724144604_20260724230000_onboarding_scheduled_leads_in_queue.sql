-- 20260724144604_20260724230000_onboarding_scheduled_leads_in_queue
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS onboarding_reviewed_at timestamptz;

DROP FUNCTION IF EXISTS public.onboarding_pending_leads(uuid);
CREATE FUNCTION public.onboarding_pending_leads(p_clinic_id uuid)
RETURNS TABLE(ticket_id uuid, lead_id uuid, name text, phone text, avatar_url text, last_appt date, next_appt date, is_scheduled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_stage uuid; v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN; END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT t.id AS ticket_id, l.id AS lead_id, l.name, l.phone, l.avatar_url,
      (SELECT max(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
           AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today) AS last_appt,
      (SELECT min(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
           AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today) AS next_appt,
      false AS is_scheduled
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.stage_id = v_stage AND t.status = 'open'

    UNION ALL

    SELECT (SELECT tk.id FROM tickets tk WHERE tk.lead_id = l.id ORDER BY (tk.status = 'open') DESC, tk.opened_at DESC LIMIT 1),
      l.id, l.name, l.phone, l.avatar_url,
      (SELECT max(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
           AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today),
      (SELECT min(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
           AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today),
      true
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.stage_id = v_stage AND tk.status = 'open')
      AND EXISTS (SELECT 1 FROM appointments a JOIN patients p ON p.id = a.patient_id
                  WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
                    AND a.status NOT IN ('cancelado','faltou'))
  ) q
  ORDER BY q.is_scheduled, q.name;
END; $function$;
REVOKE ALL ON FUNCTION public.onboarding_pending_leads(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_pending_leads(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean);
CREATE FUNCTION public.onboarding_audit_apply(
  p_ticket_id uuid, p_category text, p_last_appt_date date DEFAULT NULL, p_resolve_past boolean DEFAULT true,
  p_next_appt_date date DEFAULT NULL, p_ai_enabled boolean DEFAULT true, p_followup_enabled boolean DEFAULT true,
  p_scheduled boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    UPDATE leads SET is_not_lead = false, ai_enabled = false, followup_enabled = false WHERE id = v_lead;
    SELECT id INTO v_perdido FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'perdido' LIMIT 1;
    UPDATE tickets SET outcome = 'perdido', outcome_at = now(), status = 'closed', closed_at = coalesce(closed_at, now()),
           stage_id = coalesce(v_perdido, stage_id), loss_reason = coalesce(loss_reason, 'Onboarding') WHERE id = p_ticket_id;
    RETURN jsonb_build_object('success', true, 'action', 'lead_perdido', 'lead_id', v_lead);
  END IF;

  UPDATE leads SET is_not_lead = false, ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled WHERE id = v_lead;

  IF p_category = 'lead_potencial' THEN
    SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;
    UPDATE tickets SET stage_id = v_wa WHERE id = p_ticket_id AND status = 'open';
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
  ELSE v_action := 'paciente_passado_aberto'; END IF;

  RETURN jsonb_build_object('success', true, 'action', v_action, 'lead_id', v_lead, 'past_ticket', v_past_ticket);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-audit', 'audit_apply_failed', 'Falha ao aplicar auditoria de onboarding', 'error',
    v_clinic, jsonb_build_object('ticket_id', p_ticket_id, 'category', p_category, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END; $function$;
REVOKE ALL ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.onboarding_reset(p_clinic_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  UPDATE clinics SET onboarding_completed_at = NULL WHERE id = p_clinic_id;
  UPDATE leads SET onboarding_reviewed_at = NULL WHERE clinic_id = p_clinic_id;
  RETURN jsonb_build_object('success', true);
END; $function$;
