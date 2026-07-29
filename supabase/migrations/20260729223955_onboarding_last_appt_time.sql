-- Horário do ÚLTIMO atendimento na auditoria do onboarding (a fila já devolvia last_appt_time desde
-- 20260729173442; faltava a auditoria aceitar).
--
-- Ganho extra: com a hora, o ticket de venda retroativo recebe o timestamp REAL em vez de meia-noite,
-- então outcome_at (o eixo de data das vendas em v_kpi_wins) fica preciso. O DIA não muda, logo
-- nenhum KPI se desloca. Sem hora, o comportamento é o de antes (00:00).
--
-- Assinatura muda (11º parâmetro) => DROP das anteriores + CREATE + grants explícitos, senão o
-- PostgREST vê overload ambíguo e a chamada do front falha.
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean, time without time zone);
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean);

CREATE OR REPLACE FUNCTION public.onboarding_audit_apply(
  p_ticket_id uuid, p_category text,
  p_last_appt_date date DEFAULT NULL::date, p_resolve_past boolean DEFAULT true,
  p_next_appt_date date DEFAULT NULL::date,
  p_ai_enabled boolean DEFAULT true, p_followup_enabled boolean DEFAULT true,
  p_scheduled boolean DEFAULT false, p_human_only boolean DEFAULT false,
  p_next_appt_time time without time zone DEFAULT NULL,
  p_last_appt_time time without time zone DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid; v_clinic uuid; v_ganho uuid; v_agendado uuid; v_wa uuid; v_perdido uuid; v_sinc uuid;
  v_past_ticket uuid; v_action text; v_next_txt text; v_past_txt text; v_past_at timestamptz;
BEGIN
  SELECT lead_id, clinic_id INTO v_lead, v_clinic FROM tickets WHERE id = p_ticket_id;
  IF v_lead IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found'); END IF;
  IF NOT fn_can_onboard(v_clinic) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF p_category NOT IN ('contato_geral','lead_potencial','lead_perdido','paciente') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_category');
  END IF;

  -- Momento real do atendimento anterior (hora quando informada, senão meia-noite como antes).
  v_past_at := CASE WHEN p_last_appt_date IS NULL THEN NULL
    ELSE ((p_last_appt_date + coalesce(p_last_appt_time, '00:00'::time))::timestamp)
           AT TIME ZONE 'America/Sao_Paulo' END;

  v_past_txt := CASE WHEN p_last_appt_date IS NULL THEN NULL
    ELSE 'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY')
         || CASE WHEN p_last_appt_time IS NOT NULL THEN ' às ' || to_char(p_last_appt_time, 'HH24:MI') ELSE '' END
         || ' (onboarding)' END;

  v_next_txt := CASE WHEN p_next_appt_date IS NULL THEN NULL
    ELSE 'Próximo agendamento em ' || to_char(p_next_appt_date, 'DD/MM/YYYY')
         || CASE WHEN p_next_appt_time IS NOT NULL THEN ' às ' || to_char(p_next_appt_time, 'HH24:MI') ELSE '' END
         || ' (onboarding)' END;

  PERFORM set_config('app.onboarding_import', 'on', true);
  PERFORM set_config('app.stage_source', 'onboarding', true);
  UPDATE leads SET onboarding_reviewed_at = now(), human_only = p_human_only WHERE id = v_lead;

  -- Cliente existente: só define IA/follow-up, não toca no ticket (venda/agendamento fica intacto).
  IF p_scheduled THEN
    IF p_category = 'contato_geral' THEN
      UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false, not_lead_at = now() WHERE id = v_lead;
    ELSE
      UPDATE leads SET is_not_lead = false, ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled WHERE id = v_lead;
    END IF;
    RETURN jsonb_build_object('success', true, 'action', 'scheduled_' || p_category, 'lead_id', v_lead);
  END IF;

  -- Reset (permite reauditar), preservando anotação HUMANA.
  DELETE FROM tickets WHERE lead_id = v_lead AND id <> p_ticket_id AND coalesce(notes,'') LIKE '%(onboarding)%';
  SELECT id INTO v_sinc FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'sincronizacao' LIMIT 1;
  UPDATE tickets SET status='open', closed_at=NULL, outcome=NULL, outcome_at=NULL, loss_reason=NULL,
         stage_id=coalesce(v_sinc, stage_id),
         notes = CASE WHEN coalesce(notes,'') LIKE '%(onboarding)%' THEN NULL ELSE notes END
   WHERE id = p_ticket_id;

  IF p_category = 'contato_geral' THEN
    UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false, not_lead_at = now() WHERE id = v_lead;
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id AND status <> 'closed';
    RETURN jsonb_build_object('success', true, 'action', 'contato_geral', 'lead_id', v_lead);
  END IF;

  IF p_category = 'lead_perdido' THEN
    -- Resolver SEMPRE liga a IA (perdido é aquela oportunidade, não a pessoa). Exceção: cadeado.
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
            v_past_at, v_past_at, v_past_at, v_past_txt)
    RETURNING id INTO v_past_ticket;
    UPDATE tickets SET stage_id = coalesce(v_agendado, stage_id),
           notes = CASE WHEN coalesce(notes,'') = '' THEN v_next_txt ELSE notes || E'\n' || v_next_txt END
     WHERE id = p_ticket_id;
    v_action := 'paciente_agendado';

  ELSIF p_last_appt_date IS NOT NULL THEN
    -- Só passado: REUSA o ticket da Sincronização como o próprio ganho (sem deixar fechado órfão).
    UPDATE tickets SET stage_id = coalesce(v_ganho, stage_id), outcome = 'ganho',
           status     = CASE WHEN p_resolve_past THEN 'closed' ELSE 'open' END,
           opened_at  = v_past_at,
           closed_at  = CASE WHEN p_resolve_past THEN v_past_at END,
           outcome_at = v_past_at,
           notes = CASE WHEN coalesce(notes,'') = '' THEN v_past_txt ELSE notes || E'\n' || v_past_txt END
     WHERE id = p_ticket_id;
    v_past_ticket := p_ticket_id;
    v_action := CASE WHEN p_resolve_past THEN 'paciente_passado' ELSE 'paciente_passado_aberto' END;

  ELSIF p_next_appt_date IS NOT NULL THEN
    UPDATE tickets SET stage_id = coalesce(v_agendado, stage_id),
           notes = CASE WHEN coalesce(notes,'') = '' THEN v_next_txt ELSE notes || E'\n' || v_next_txt END
     WHERE id = p_ticket_id;
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

REVOKE ALL ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean, time without time zone, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean, time without time zone, time without time zone) TO authenticated, service_role;
