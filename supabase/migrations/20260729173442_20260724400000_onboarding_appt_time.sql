-- 20260729173442_20260724400000_onboarding_appt_time
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Horário do agendamento no onboarding: a fila devolve a HORA (agenda) junto das datas, e a
-- auditoria aceita p_next_appt_time (vai para as notas do ticket Agendado). Tipos de retorno /
-- assinatura mudam => DROP + CREATE + grants explícitos.
DROP FUNCTION IF EXISTS public.onboarding_pending_leads(uuid);

CREATE OR REPLACE FUNCTION public.onboarding_pending_leads(p_clinic_id uuid)
 RETURNS TABLE(ticket_id uuid, lead_id uuid, name text, phone text, avatar_url text,
               last_appt date, last_appt_time time without time zone,
               next_appt date, next_appt_time time without time zone, is_scheduled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage uuid; v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_months integer; v_cutoff timestamp;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN; END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;
  SELECT onboarding_period_months INTO v_months FROM clinics WHERE id = p_clinic_id;
  v_cutoff := CASE WHEN v_months IS NULL THEN '1900-01-01'::timestamp
                   ELSE (now() AT TIME ZONE 'America/Sao_Paulo') - (v_months || ' months')::interval END;

  RETURN QUERY
  SELECT * FROM (
    SELECT t.id AS ticket_id, l.id AS lead_id, l.name, l.phone, l.avatar_url,
      pa.d AS last_appt, pa.t AS last_appt_time, na.d AS next_appt, na.t AS next_appt_time,
      false AS is_scheduled
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today
       ORDER BY a.date DESC, a."time" DESC LIMIT 1) pa ON true
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today
       ORDER BY a.date ASC, a."time" ASC LIMIT 1) na ON true
    WHERE t.clinic_id = p_clinic_id AND t.stage_id = v_stage AND t.status = 'open'
      AND l.created_at >= v_cutoff

    UNION ALL

    SELECT (SELECT tk.id FROM tickets tk WHERE tk.lead_id = l.id ORDER BY (tk.status = 'open') DESC, tk.opened_at DESC LIMIT 1),
      l.id, l.name, l.phone, l.avatar_url,
      pa.d, pa.t, na.d, na.t, true
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today
       ORDER BY a.date DESC, a."time" DESC LIMIT 1) pa ON true
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today
       ORDER BY a.date ASC, a."time" ASC LIMIT 1) na ON true
    WHERE l.clinic_id = p_clinic_id
      AND l.created_at >= v_cutoff
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.stage_id = v_stage AND tk.status = 'open')
      AND (
        pa.d IS NOT NULL OR na.d IS NOT NULL
        OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.outcome = 'ganho')
      )
  ) q
  ORDER BY q.is_scheduled, q.name;
END; $function$;

REVOKE ALL ON FUNCTION public.onboarding_pending_leads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_pending_leads(uuid) TO authenticated, service_role;

-- Auditoria: p_next_appt_time entra nas notas do ticket Agendado ("… às HH:MM").
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.onboarding_audit_apply(p_ticket_id uuid, p_category text, p_last_appt_date date DEFAULT NULL::date, p_resolve_past boolean DEFAULT true, p_next_appt_date date DEFAULT NULL::date, p_ai_enabled boolean DEFAULT true, p_followup_enabled boolean DEFAULT true, p_scheduled boolean DEFAULT false, p_human_only boolean DEFAULT false, p_next_appt_time time without time zone DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid; v_clinic uuid; v_ganho uuid; v_agendado uuid; v_wa uuid; v_perdido uuid; v_sinc uuid;
  v_past_ticket uuid; v_action text; v_next_txt text;
BEGIN
  SELECT lead_id, clinic_id INTO v_lead, v_clinic FROM tickets WHERE id = p_ticket_id;
  IF v_lead IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found'); END IF;
  IF NOT fn_can_onboard(v_clinic) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF p_category NOT IN ('contato_geral','lead_potencial','lead_perdido','paciente') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_category');
  END IF;

  v_next_txt := CASE WHEN p_next_appt_date IS NULL THEN NULL
    ELSE 'Próximo agendamento em ' || to_char(p_next_appt_date, 'DD/MM/YYYY')
         || CASE WHEN p_next_appt_time IS NOT NULL THEN ' às ' || to_char(p_next_appt_time, 'HH24:MI') ELSE '' END
         || ' (onboarding)' END;

  PERFORM set_config('app.onboarding_import', 'on', true);
  PERFORM set_config('app.stage_source', 'onboarding', true);
  UPDATE leads SET onboarding_reviewed_at = now(), human_only = p_human_only WHERE id = v_lead;

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

  -- p_category = 'paciente'
  IF p_last_appt_date IS NOT NULL AND NOT p_resolve_past AND p_next_appt_date IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'resolve_past_required_with_open_current');
  END IF;

  SELECT id INTO v_ganho    FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'ganho'    LIMIT 1;
  SELECT id INTO v_agendado FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'agendado' LIMIT 1;
  SELECT id INTO v_wa       FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;

  IF p_last_appt_date IS NOT NULL AND p_next_appt_date IS NOT NULL THEN
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, outcome, opened_at, closed_at, outcome_at, notes)
    VALUES (v_clinic, v_lead, coalesce(v_ganho, v_sinc), 'closed', 'ganho',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY') || ' (onboarding)')
    RETURNING id INTO v_past_ticket;
    UPDATE tickets SET stage_id = coalesce(v_agendado, stage_id), notes = v_next_txt WHERE id = p_ticket_id;
    v_action := 'paciente_agendado';

  ELSIF p_last_appt_date IS NOT NULL THEN
    UPDATE tickets SET stage_id = coalesce(v_ganho, stage_id), outcome = 'ganho',
           status     = CASE WHEN p_resolve_past THEN 'closed' ELSE 'open' END,
           opened_at  = (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
           closed_at  = CASE WHEN p_resolve_past THEN (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo' END,
           outcome_at = (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
           notes = 'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY') || ' (onboarding)'
     WHERE id = p_ticket_id;
    v_past_ticket := p_ticket_id;
    v_action := CASE WHEN p_resolve_past THEN 'paciente_passado' ELSE 'paciente_passado_aberto' END;

  ELSIF p_next_appt_date IS NOT NULL THEN
    UPDATE tickets SET stage_id = coalesce(v_agendado, stage_id), notes = v_next_txt WHERE id = p_ticket_id;
    v_action := 'paciente_agendado';

  ELSE
    UPDATE tickets SET stage_id = coalesce(v_wa, stage_id) WHERE id = p_ticket_id;
    v_action := 'paciente_ativo';
  END IF;

  RETURN jsonb_build_object('success', true, 'action', v_action, 'lead_id', v_lead, 'past_ticket', v_past_ticket);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-audit', 'audit_apply_failed', 'Falha ao aplicar auditoria de onboarding', 'error',
    v_clinic, jsonb_build_object('ticket_id', p_ticket_id, 'category', p_category, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END; $function$;

REVOKE ALL ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean, time without time zone) TO authenticated, service_role;
