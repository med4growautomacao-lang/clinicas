CREATE OR REPLACE FUNCTION public.get_commercial_dashboard(
  p_clinic_id uuid,
  p_entry_from date,
  p_entry_to date,
  p_agenda_from date,
  p_agenda_to date,
  p_agent text DEFAULT 'todos'::text,
  p_origin text DEFAULT 'todos'::text,
  p_channel text DEFAULT 'todos'::text,
  p_conv_from date DEFAULT NULL::date,
  p_conv_to date DEFAULT NULL::date,
  p_outcome text DEFAULT 'ambos'::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ganho_stage_id uuid;
  v_ia_msgs int; v_human_msgs int; v_inbound_msgs int; v_total_msgs int;
  v_ia_leads_touched int; v_human_leads_touched int;
  v_appt_ia int; v_appt_manual int; v_appt_total int; v_appt_generated int; v_appt_status jsonb;
  v_ia_enabled int; v_ia_autonomous int; v_handoffs int;
  v_auto jsonb;
  v_sla_breaches int; v_response_cycles int;
  v_median_first_response numeric; v_avg_response numeric; v_avg_over_breach numeric;
  v_sla_minutes int;
  v_bh jsonb; v_sh int; v_sm int; v_eh int; v_em int; v_days int[]; v_has_bh boolean;
  v_won int; v_lost int; v_loss_reasons jsonb;
  v_revenue numeric; v_revenue_scoped numeric; v_investment numeric; v_investment_total numeric;
  v_sales_cycle numeric; v_attended_consults int; v_converted_value numeric;
  v_default_ticket numeric;
  v_csat_type text; v_csat_answered int; v_csat_avg numeric; v_csat_dist jsonb;
  v_funnel jsonb; v_daily jsonb;
  v_total_leads int; v_new_leads int; v_leads_not_attended int;
  v_d_from date; v_d_to date;
  v_agenda_funil boolean; v_agendado_stage_id uuid; v_falta_stage_id uuid; v_falta_cnt int;
BEGIN
  SELECT id INTO v_ganho_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'ganho' LIMIT 1;
  SELECT COALESCE((features->>'agenda_via_funil')::boolean, false) INTO v_agenda_funil FROM clinics WHERE id = p_clinic_id;
  IF v_agenda_funil THEN
    SELECT id INTO v_agendado_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'agendado' LIMIT 1;
    SELECT id INTO v_falta_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'faltou_cancelou' LIMIT 1;
  END IF;
  -- Janela padrão do gráfico diário: prefere Agendado (a maioria das séries do
  -- gráfico é atividade operacional), cai para Conversão, depois Entrada.
  v_d_from := COALESCE(p_agenda_from, p_conv_from, p_entry_from, CURRENT_DATE - 29);
  v_d_to   := COALESCE(p_agenda_to,   p_conv_to,   p_entry_to,   CURRENT_DATE);

  SELECT COUNT(*) INTO v_total_leads FROM leads WHERE clinic_id = p_clinic_id AND COALESCE(is_not_lead, false) = false;

  -- ===== Eixo ENTRADA (leads.created_at) — sem mudança =====
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE ai_enabled),
    COUNT(*) FILTER (WHERE ai_enabled AND handoff_triggered_at IS NULL)
  INTO v_new_leads, v_ia_enabled, v_ia_autonomous
  FROM leads l
  WHERE clinic_id = p_clinic_id
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN source = 'meta_ads' THEN 'meta' WHEN source = 'google_ads' THEN 'google' WHEN source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')));

  -- ===== Eixo AGENDADO (atividade operacional: mensagens/SLA/handoffs/automações/
  -- CSAT/investimento/agendamento gerado) — era o antigo p_conv (pill "Agenda"),
  -- comportamento preservado, só o nome do parâmetro mudou pra bater com o pill. =====
  SELECT COUNT(*) INTO v_handoffs FROM leads l
  WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL
    AND (p_agenda_from IS NULL OR handoff_triggered_at::date >= p_agenda_from)
    AND (p_agenda_to   IS NULL OR handoff_triggered_at::date <= p_agenda_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN source = 'meta_ads' THEN 'meta' WHEN source = 'google_ads' THEN 'google' WHEN source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT sla_minutes, business_hours, csat_type, default_ticket_value
    INTO v_sla_minutes, v_bh, v_csat_type, v_default_ticket
  FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1;

  v_has_bh := v_bh IS NOT NULL AND (v_bh ? 'start') AND (v_bh ? 'end') AND (v_bh ? 'days');
  IF v_has_bh THEN
    v_sh := SPLIT_PART(v_bh->>'start', ':', 1)::int;
    v_sm := COALESCE(NULLIF(SPLIT_PART(v_bh->>'start', ':', 2), ''), '0')::int;
    v_eh := SPLIT_PART(v_bh->>'end',   ':', 1)::int;
    v_em := COALESCE(NULLIF(SPLIT_PART(v_bh->>'end',   ':', 2), ''), '0')::int;
    SELECT array_agg(d::int) INTO v_days FROM jsonb_array_elements_text(v_bh->'days') d;
  END IF;

  WITH stream AS (
    SELECT cm.lead_id, cm.created_at, cm.sender,
      CASE
        WHEN cm.direction = 'inbound' THEN 'in'
        WHEN (p_agent = 'todos' AND cm.direction = 'outbound' AND cm.sender <> 'system')
          OR (p_agent = 'ia' AND cm.sender = 'ai')
          OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound') THEN 'out'
        ELSE NULL
      END AS kind
    FROM chat_messages cm
    JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id
      AND (p_agenda_from IS NULL OR cm.created_at::date >= p_agenda_from)
      AND (p_agenda_to   IS NULL OR cm.created_at::date <= p_agenda_to)
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
  ),
  lagged AS (
    SELECT lead_id, created_at, sender, kind,
      LAG(kind)       OVER (PARTITION BY lead_id ORDER BY created_at) AS prev_kind,
      LAG(created_at) OVER (PARTITION BY lead_id ORDER BY created_at) AS prev_at
    FROM stream WHERE kind IS NOT NULL
  ),
  cyc AS (
    SELECT lead_id, prev_at AS in_at, created_at AS out_at,
      GREATEST(0, EXTRACT(EPOCH FROM (created_at - prev_at)) / 60.0) AS raw_min
    FROM lagged
    WHERE kind = 'out' AND prev_kind = 'in'
      AND NOT (sender = 'ai' AND EXTRACT(EPOCH FROM (created_at - prev_at)) / 60.0 > 60)
  ),
  firsts AS (
    SELECT DISTINCT ON (lead_id) lead_id, raw_min FROM cyc ORDER BY lead_id, in_at
  )
  SELECT
    COALESCE((SELECT AVG(raw_min) FROM firsts), 0),
    COALESCE((SELECT AVG(raw_min) FROM cyc), 0),
    COALESCE((SELECT COUNT(*) FROM cyc), 0)
  INTO v_median_first_response, v_avg_response, v_response_cycles;

  SELECT COUNT(*), COALESCE(AVG(sb.overshoot_min), 0)
  INTO v_sla_breaches, v_avg_over_breach
  FROM sla_breaches sb JOIN leads l ON l.id = sb.lead_id
  WHERE sb.clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR sb.breached_at::date >= p_agenda_from)
    AND (p_agenda_to   IS NULL OR sb.breached_at::date <= p_agenda_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR (p_agent = 'ia' AND sb.sender = 'ai') OR (p_agent = 'humano' AND sb.sender = 'human'))
    AND NOT (sb.sender = 'ai' AND sb.wait_raw_min > 60);

  SELECT
    COUNT(*) FILTER (WHERE cm.sender = 'ai'),
    COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound'),
    COUNT(*) FILTER (WHERE cm.direction = 'inbound'),
    COUNT(*)
  INTO v_ia_msgs, v_human_msgs, v_inbound_msgs, v_total_msgs
  FROM chat_messages cm LEFT JOIN leads l ON l.id = cm.lead_id
  WHERE cm.clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR cm.created_at::date >= p_agenda_from)
    AND (p_agenda_to   IS NULL OR cm.created_at::date <= p_agenda_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  WITH cohort AS (
    SELECT l.id AS lead_id
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
  )
  -- Atribuicao IA x Humano: regua canonica precomputada (vw_lead_agent_class ->
  -- lead_kpi_attribution), MESMA fonte da Visao Geral.
  SELECT
    COUNT(*) FILTER (WHERE v.agent = 'ia'),
    COUNT(*) FILTER (WHERE v.agent = 'humano')
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM cohort c
  LEFT JOIN public.vw_lead_agent_class v ON v.lead_id = c.lead_id AND v.clinic_id = p_clinic_id;

  v_leads_not_attended := GREATEST(COALESCE(v_new_leads,0) - COALESCE(v_ia_leads_touched,0) - COALESCE(v_human_leads_touched,0), 0);

  -- Quem MARCOU o agendamento (booking attribution) — eixo Agendado (a.created_at).
  SELECT
    COUNT(*) FILTER (WHERE a.source = 'ia'),
    COUNT(*) FILTER (WHERE a.source = 'manual'),
    COUNT(*) FILTER (WHERE p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
  INTO v_appt_ia, v_appt_manual, v_appt_total
  FROM appointments a
  LEFT JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR a.created_at::date >= p_agenda_from)
    AND (p_agenda_to   IS NULL OR a.created_at::date <= p_agenda_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  -- Agendamento GERADO (v_kpi_scheduled: união agendamento∪etapa) — eixo Agendado.
  SELECT COUNT(*) INTO v_appt_generated
  FROM v_kpi_scheduled sc
  JOIN leads l ON l.id = sc.lead_id
  WHERE sc.clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR sc.day >= p_agenda_from)
    AND (p_agenda_to   IS NULL OR sc.day <= p_agenda_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    AND (p_origin = 'todos' OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT COALESCE(jsonb_object_agg(type, cnt), '{}'::jsonb) INTO v_auto
  FROM (
    SELECT al.type, COUNT(*) AS cnt FROM automation_logs al LEFT JOIN leads l ON l.id = al.lead_id
    WHERE al.clinic_id = p_clinic_id AND al.status = 'sent'
      AND (p_agenda_from IS NULL OR al.triggered_at::date >= p_agenda_from)
      AND (p_agenda_to   IS NULL OR al.triggered_at::date <= p_agenda_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY al.type
  ) a;

  SELECT COUNT(*), AVG(csat_score) INTO v_csat_answered, v_csat_avg FROM leads
  WHERE clinic_id = p_clinic_id AND csat_score IS NOT NULL
    AND (p_agenda_from IS NULL OR csat_answered_at::date >= p_agenda_from)
    AND (p_agenda_to   IS NULL OR csat_answered_at::date <= p_agenda_to)
    AND COALESCE(is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN source = 'meta_ads' THEN 'meta' WHEN source = 'google_ads' THEN 'google' WHEN source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('score', score, 'count', cnt) ORDER BY score DESC), '[]'::jsonb) INTO v_csat_dist
  FROM (
    SELECT csat_score AS score, COUNT(*) AS cnt FROM leads
    WHERE clinic_id = p_clinic_id AND csat_score IS NOT NULL
      AND (p_agenda_from IS NULL OR csat_answered_at::date >= p_agenda_from)
      AND (p_agenda_to   IS NULL OR csat_answered_at::date <= p_agenda_to)
      AND COALESCE(is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN source = 'meta_ads' THEN 'meta' WHEN source = 'google_ads' THEN 'google' WHEN source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY csat_score
  ) d;

  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM v_kpi_investment
  WHERE clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR day >= p_agenda_from) AND (p_agenda_to IS NULL OR day <= p_agenda_to);

  SELECT COALESCE(SUM(investment), 0) INTO v_investment FROM v_kpi_investment
  WHERE clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR day >= p_agenda_from) AND (p_agenda_to IS NULL OR day <= p_agenda_to)
    AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')))
    AND COALESCE(p_channel, 'todos') = 'todos' AND COALESCE(p_agent, 'todos') = 'todos';

  -- ===== Eixo CONVERSÃO (COALESCE(outcome_at,closed_at) + appointments.date —
  -- mesma janela, cada métrica lê sua própria coluna) — era o antigo p_appt +
  -- metade do antigo p_conv. Toggle p_outcome ('ganho'|'perdido'|'ambos'). =====
  SELECT
    COUNT(*) FILTER (WHERE t.outcome = 'ganho'),
    COUNT(*) FILTER (WHERE t.outcome = 'perdido')
  INTO v_won, v_lost
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome IS NOT NULL
    AND (p_outcome = 'ambos' OR t.outcome = p_outcome)
    AND (p_conv_from IS NULL OR COALESCE(t.outcome_at, t.closed_at)::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR COALESCE(t.outcome_at, t.closed_at)::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  -- Motivo de perda (novo — reaproveita v_kpi_outcomes, fonte única do dia de
  -- desfecho, em vez de recalcular COALESCE(outcome_at,closed_at) de novo).
  IF p_outcome IN ('perdido', 'ambos') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', reason, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_loss_reasons
    FROM (
      SELECT COALESCE(NULLIF(o.loss_reason, ''), '(sem motivo registrado)') AS reason, COUNT(*) AS cnt
      FROM public.v_kpi_outcomes o
      JOIN leads l ON l.id = o.lead_id
      WHERE o.clinic_id = p_clinic_id AND o.outcome = 'perdido'
        AND (p_conv_from IS NULL OR o.day >= p_conv_from)
        AND (p_conv_to   IS NULL OR o.day <= p_conv_to)
        AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
        AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
        AND (p_origin = 'todos'
          OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
      GROUP BY 1
    ) r;
  ELSE
    v_loss_reasons := '[]'::jsonb;
  END IF;

  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_revenue
  FROM conversions c
  LEFT JOIN leads l ON l.id = c.lead_id
  LEFT JOIN tickets t2 ON t2.id = c.ticket_id
  WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
    AND (p_outcome = 'ambos' OR t2.outcome = p_outcome)
    AND (p_conv_from IS NULL OR c.converted_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR c.converted_at::date <= p_conv_to)
    AND (l.id IS NULL OR COALESCE(l.is_not_lead, false) = false)
    AND ((p_entry_from IS NULL AND p_entry_to IS NULL)
      OR ((p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
          AND (p_entry_to IS NULL OR l.created_at::date <= p_entry_to)));

  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_revenue_scoped
  FROM conversions c
  LEFT JOIN leads l ON l.id = c.lead_id
  LEFT JOIN tickets t2 ON t2.id = c.ticket_id
  WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
    AND (p_outcome = 'ambos' OR t2.outcome = p_outcome)
    AND (p_conv_from IS NULL OR c.converted_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR c.converted_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (l.id IS NULL OR COALESCE(l.is_not_lead, false) = false)
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  -- Ciclo: até o Ganho por padrão; até a Perda quando o toggle está em 'perdido'.
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0) INTO v_sales_cycle
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = (CASE WHEN p_outcome = 'perdido' THEN 'perdido' ELSE 'ganho' END)
    AND (p_conv_from IS NULL OR t.outcome_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR t.outcome_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT COUNT(*) INTO v_attended_consults
  FROM appointments a
  LEFT JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id AND a.status IN ('realizado', 'compareceu')
    AND (p_conv_from IS NULL OR a.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false;

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_appt_status
  FROM (
    SELECT COALESCE(a.status, 'indefinido') AS status, COUNT(*) AS cnt
    FROM appointments a
    LEFT JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id
      AND (p_conv_from IS NULL OR a.date >= p_conv_from)
      AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ) s;

  IF v_agenda_funil THEN
    SELECT COUNT(DISTINCT h.ticket_id) INTO v_appt_total
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id = v_agendado_stage_id
      AND (p_agenda_from IS NULL OR h.changed_at::date >= p_agenda_from)
      AND (p_agenda_to   IS NULL OR h.changed_at::date <= p_agenda_to)
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));
    v_appt_ia := 0; v_appt_manual := v_appt_total;

    SELECT
      COUNT(DISTINCT h.ticket_id) FILTER (WHERE h.new_stage_id = v_ganho_stage_id),
      COUNT(DISTINCT h.ticket_id) FILTER (WHERE h.new_stage_id = v_falta_stage_id)
    INTO v_attended_consults, v_falta_cnt
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id IN (v_ganho_stage_id, v_falta_stage_id)
      AND (p_conv_from IS NULL OR h.changed_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR h.changed_at::date <= p_conv_to)
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

    v_appt_status := jsonb_build_object('realizado', COALESCE(v_attended_consults, 0), 'faltou', COALESCE(v_falta_cnt, 0));
  END IF;

  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_converted_value
  FROM conversions c
  LEFT JOIN leads l ON l.id = c.lead_id
  LEFT JOIN tickets t2 ON t2.id = c.ticket_id
  WHERE c.clinic_id = p_clinic_id
    AND (p_outcome = 'ambos' OR t2.outcome = p_outcome)
    AND (p_conv_from IS NULL OR c.converted_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR c.converted_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false;

  -- ===== Funil por etapa — eixo Entrada (sem mudança) =====
  WITH entries AS (
    SELECT h.ticket_id, h.new_stage_id AS stage_id, MAX(h.changed_at) AS last_entry
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id IS NOT NULL AND h.ticket_id IS NOT NULL
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY h.ticket_id, h.new_stage_id
  ),
  counts AS (SELECT stage_id, COUNT(*)::int AS leads FROM entries GROUP BY stage_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage_id', fs.id, 'name', fs.name, 'slug', fs.slug, 'position', fs.position,
    'is_conversion', fs.is_conversion, 'color', fs.color, 'leads', COALESCE(c.leads, 0)) ORDER BY fs.position), '[]'::jsonb)
  INTO v_funnel
  FROM funnel_stages fs LEFT JOIN counts c ON c.stage_id = fs.id
  WHERE fs.clinic_id = p_clinic_id;

  WITH dates AS (SELECT generate_series(v_d_from, v_d_to, interval '1 day')::date AS d),
  msgs AS (
    SELECT cm.created_at::date AS d,
      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_msgs,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_msgs
    FROM chat_messages cm LEFT JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id AND cm.created_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  ld AS (
    SELECT created_at::date AS d, COUNT(*) AS leads FROM leads
    WHERE clinic_id = p_clinic_id AND created_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN source = 'meta_ads' THEN 'meta' WHEN source = 'google_ads' THEN 'google' WHEN source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  ap AS (
    SELECT a.created_at::date AS d,
      COUNT(*) AS appts,
      COUNT(*) FILTER (WHERE COALESCE(a.status, '') NOT IN ('cancelado', 'faltou')) AS valid_appts
    FROM appointments a
    LEFT JOIN tickets t ON t.id = a.ticket_id LEFT JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id AND a.created_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  rz AS (
    SELECT a.date AS d, COUNT(*) AS realizadas FROM appointments a
    LEFT JOIN tickets t ON t.id = a.ticket_id LEFT JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id AND a.status IN ('realizado', 'compareceu') AND a.date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  rev AS (
    SELECT c.converted_at::date AS d, SUM(c.value::numeric) AS faturamento
    FROM conversions c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
      AND c.converted_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ','))) GROUP BY 1
  ),
  apf AS (
    SELECT h.changed_at::date AS d, COUNT(DISTINCT h.ticket_id) AS appts
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE v_agenda_funil AND h.clinic_id = p_clinic_id AND h.new_stage_id = v_agendado_stage_id
      AND h.changed_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  rzf AS (
    SELECT h.changed_at::date AS d, COUNT(DISTINCT h.ticket_id) AS realizadas
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE v_agenda_funil AND h.clinic_id = p_clinic_id AND h.new_stage_id = v_ganho_stage_id
      AND h.changed_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  wg AS (
    SELECT COALESCE(t.outcome_at, t.closed_at)::date AS d, COUNT(*) AS ganhos
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
      AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  mkt AS (
    SELECT day AS d, SUM(investment) AS investment FROM v_kpi_investment
    WHERE clinic_id = p_clinic_id AND day BETWEEN v_d_from AND v_d_to
      AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')))
      AND COALESCE(p_channel, 'todos') = 'todos' AND COALESCE(p_agent, 'todos') = 'todos'
    GROUP BY 1
  ),
  hd AS (
    SELECT handoff_triggered_at::date AS d, COUNT(*) AS handoffs FROM leads
    WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL AND handoff_triggered_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN source = 'meta_ads' THEN 'meta' WHEN source = 'google_ads' THEN 'google' WHEN source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  fu AS (
    SELECT al.triggered_at::date AS d, COUNT(*) AS followups FROM automation_logs al
    WHERE al.clinic_id = p_clinic_id AND al.type = 'followup' AND al.status = 'sent' AND al.triggered_at::date BETWEEN v_d_from AND v_d_to
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'date', to_char(dates.d, 'YYYY-MM-DD'),
    'aiMessages', COALESCE(m.ai_msgs, 0), 'humanMessages', COALESCE(m.human_msgs, 0),
    'leads', COALESCE(l.leads, 0),
    'appointments', CASE WHEN v_agenda_funil THEN COALESCE(apf.appts, 0) ELSE COALESCE(a.appts, 0) END,
    'realizadas', CASE WHEN v_agenda_funil THEN COALESCE(rzf.realizadas, 0) ELSE COALESCE(rz.realizadas, 0) END,
    'ganhos', COALESCE(wg.ganhos, 0),
    'faturamento', COALESCE(rev.faturamento, 0),
    'faturamentoProjetado', (CASE WHEN v_agenda_funil THEN COALESCE(apf.appts, 0) ELSE COALESCE(a.valid_appts, 0) END) * COALESCE(v_default_ticket, 0),
    'investment', COALESCE(mk.investment, 0),
    'handoffs', COALESCE(h.handoffs, 0), 'followups', COALESCE(f.followups, 0)) ORDER BY dates.d)
  INTO v_daily
  FROM dates
  LEFT JOIN msgs m ON m.d = dates.d LEFT JOIN ld l ON l.d = dates.d
  LEFT JOIN ap a ON a.d = dates.d LEFT JOIN rz ON rz.d = dates.d LEFT JOIN rev ON rev.d = dates.d
  LEFT JOIN apf ON apf.d = dates.d LEFT JOIN rzf ON rzf.d = dates.d
  LEFT JOIN wg ON wg.d = dates.d LEFT JOIN mkt mk ON mk.d = dates.d
  LEFT JOIN hd h ON h.d = dates.d LEFT JOIN fu f ON f.d = dates.d;

  RETURN jsonb_build_object(
    'entry', jsonb_build_object('from', p_entry_from, 'to', p_entry_to),
    'agenda', jsonb_build_object('from', p_agenda_from, 'to', p_agenda_to),
    'conv', jsonb_build_object('from', p_conv_from, 'to', p_conv_to),
    'outcomeFilter', COALESCE(p_outcome, 'ambos'),
    'agents', jsonb_build_object(
      'ia', jsonb_build_object('messagesOut', COALESCE(v_ia_msgs,0), 'leadsTouched', COALESCE(v_ia_leads_touched,0),
        'appointments', COALESCE(v_appt_ia,0), 'leadsEnabled', COALESCE(v_ia_enabled,0),
        'autonomous', COALESCE(v_ia_autonomous,0), 'handoffs', COALESCE(v_handoffs,0)),
      'humano', jsonb_build_object('messagesOut', COALESCE(v_human_msgs,0), 'leadsTouched', COALESCE(v_human_leads_touched,0),
        'appointments', COALESCE(v_appt_manual,0), 'handoffsReceived', COALESCE(v_handoffs,0)),
      'sistema', jsonb_build_object('automations', COALESCE(v_auto,'{}'::jsonb))
    ),
    'messages', jsonb_build_object('inbound', COALESCE(v_inbound_msgs,0), 'total', COALESCE(v_total_msgs,0)),
    'appointments', jsonb_build_object('total', COALESCE(v_appt_total,0), 'ia', COALESCE(v_appt_ia,0),
      'manual', COALESCE(v_appt_manual,0), 'byStatus', COALESCE(v_appt_status,'{}'::jsonb), 'generated', COALESCE(v_appt_generated,0)),
    'sla', jsonb_build_object(
      'firstResponseMin', ROUND(COALESCE(v_median_first_response,0),2),
      'responseMin', ROUND(COALESCE(v_avg_response,0),2),
      'breaches', COALESCE(v_sla_breaches,0),
      'overBreachMin', ROUND(COALESCE(v_avg_over_breach,0),1),
      'responseCycles', COALESCE(v_response_cycles,0),
      'slaMinutes', COALESCE(v_sla_minutes,0)),
    'finance', jsonb_build_object('revenue', COALESCE(v_revenue,0), 'revenueScoped', COALESCE(v_revenue_scoped,0), 'investment', COALESCE(v_investment,0),
      'investmentTotal', COALESCE(v_investment_total,0), 'convertedValue', COALESCE(v_converted_value,0),
      'salesCycleDays', ROUND(COALESCE(v_sales_cycle,0),1), 'attendedConsults', COALESCE(v_attended_consults,0),
      'defaultTicket', COALESCE(v_default_ticket,0)),
    'outcomes', jsonb_build_object('won', COALESCE(v_won,0), 'lost', COALESCE(v_lost,0), 'lossReasons', COALESCE(v_loss_reasons,'[]'::jsonb)),
    'csat', jsonb_build_object('type', COALESCE(v_csat_type,'csat'), 'answered', COALESCE(v_csat_answered,0),
      'avg', v_csat_avg, 'distribution', COALESCE(v_csat_dist,'[]'::jsonb)),
    'funnel', COALESCE(v_funnel,'[]'::jsonb), 'daily', COALESCE(v_daily,'[]'::jsonb),
    'totalLeads', COALESCE(v_total_leads,0), 'newLeads', COALESCE(v_new_leads,0), 'leadsNotAttended', COALESCE(v_leads_not_attended,0),
    'agendaViaFunil', COALESCE(v_agenda_funil, false)
  );
END;
$function$;

-- Assinatura mudou (p_appt_from/to saíram, p_agenda_from/to e p_outcome
-- entraram) — precisa dropar o overload antigo, senão fica ambíguo pro PostgREST.
DROP FUNCTION IF EXISTS public.get_commercial_dashboard(uuid, date, date, date, date, text, text, text, date, date);
