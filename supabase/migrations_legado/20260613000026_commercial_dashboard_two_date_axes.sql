-- Painel Comercial com DOIS eixos de data (como o Funil de Oportunidades):
--   ENTRADA  (p_entry_from/to)  = coorte de leads, por leads.created_at. NULL = "Todos".
--   CONVERSÃO (p_conv_from/to)  = data do EVENTO/resultado. NULL = "Todos".
-- KPIs de RESULTADO (consultas, vendas, faturamento, valor convertido) = AND dos dois eixos:
--   lead entrou na janela de Entrada E o evento caiu na janela de Conversão.
-- KPIs de COORTE (Leads, SLA, tempo de resposta, funil) = só Entrada.
-- Investimento/ROAS e Tendências = só Conversão (evento). Agente/origem continuam como filtros globais.
DROP FUNCTION IF EXISTS public.get_commercial_dashboard(uuid, date, date, text, text);

CREATE OR REPLACE FUNCTION public.get_commercial_dashboard(
  p_clinic_id uuid,
  p_entry_from date, p_entry_to date,
  p_conv_from date, p_conv_to date,
  p_agent text DEFAULT 'todos', p_origin text DEFAULT 'todos'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ganho_stage_id uuid;
  v_ia_msgs int; v_human_msgs int; v_inbound_msgs int; v_total_msgs int;
  v_ia_leads_touched int; v_human_leads_touched int;
  v_appt_ia int; v_appt_manual int; v_appt_total int; v_appt_status jsonb;
  v_ia_enabled int; v_ia_autonomous int; v_handoffs int;
  v_auto jsonb;
  v_sla_breaches int; v_pending int;
  v_avg_first_response numeric; v_median_first_response numeric; v_sla_minutes int;
  v_won int; v_lost int;
  v_revenue numeric; v_investment numeric; v_investment_total numeric;
  v_sales_cycle numeric; v_attended_consults int; v_converted_value numeric;
  v_csat_type text; v_csat_answered int; v_csat_avg numeric; v_csat_dist jsonb;
  v_funnel jsonb; v_daily jsonb;
  v_total_leads int; v_new_leads int;
  v_d_from date; v_d_to date;
BEGIN
  SELECT id INTO v_ganho_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'ganho' LIMIT 1;
  v_d_from := COALESCE(p_conv_from, p_entry_from, CURRENT_DATE - 29);
  v_d_to   := COALESCE(p_conv_to,   p_entry_to,   CURRENT_DATE);

  -- ===== COORTE (por ENTRADA): leads + lifecycle =====
  SELECT COUNT(*) INTO v_total_leads FROM leads WHERE clinic_id = p_clinic_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE ai_enabled),
    COUNT(*) FILTER (WHERE ai_enabled AND handoff_triggered_at IS NULL),
    COALESCE(SUM(sla_breach_count), 0)
  INTO v_new_leads, v_ia_enabled, v_ia_autonomous, v_sla_breaches
  FROM leads l
  WHERE clinic_id = p_clinic_id
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  -- handoffs: por CONVERSÃO (evento) + coorte ENTRADA
  SELECT COUNT(*) INTO v_handoffs FROM leads l
  WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL
    AND (p_conv_from IS NULL OR handoff_triggered_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR handoff_triggered_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  -- aguardando resposta: snapshot (sem data) + origem
  SELECT COUNT(*) INTO v_pending FROM leads
  WHERE clinic_id = p_clinic_id AND last_message_at IS NOT NULL
    AND (last_outbound_at IS NULL OR last_message_at > last_outbound_at)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  -- 1ª resposta: coorte ENTRADA (leads criados na janela), 1º outbound do agente (qualquer data)
  WITH resp AS (
    SELECT EXTRACT(EPOCH FROM (fo.first_out - nl.created_at)) / 60.0 AS mins
    FROM (
      SELECT id, created_at FROM leads l
      WHERE clinic_id = p_clinic_id
        AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
        AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
        AND (p_origin = 'todos'
          OR (p_origin = 'meta' AND source = 'meta_ads')
          OR (p_origin = 'google' AND source = 'google_ads')
          OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
    ) nl
    JOIN (
      SELECT lead_id, MIN(created_at) AS first_out FROM chat_messages
      WHERE clinic_id = p_clinic_id AND (
        (p_agent = 'todos'  AND direction = 'outbound')
        OR (p_agent = 'ia'     AND sender = 'ai')
        OR (p_agent = 'humano' AND sender = 'human' AND direction = 'outbound'))
      GROUP BY lead_id
    ) fo ON fo.lead_id = nl.id
    WHERE fo.first_out >= nl.created_at
  )
  SELECT COALESCE(AVG(mins),0), COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY mins),0)
  INTO v_avg_first_response, v_median_first_response FROM resp;

  SELECT sla_minutes, csat_type INTO v_sla_minutes, v_csat_type FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1;

  -- ===== EVENTO (por CONVERSÃO) — mensagens/atividade =====
  SELECT
    COUNT(*) FILTER (WHERE cm.sender = 'ai'),
    COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound'),
    COUNT(*) FILTER (WHERE cm.direction = 'inbound'),
    COUNT(*)
  INTO v_ia_msgs, v_human_msgs, v_inbound_msgs, v_total_msgs
  FROM chat_messages cm LEFT JOIN leads l ON l.id = cm.lead_id
  WHERE cm.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  -- leads ATENDIDOS por agente: coorte ENTRADA + mensagem do agente na janela CONVERSÃO
  SELECT
    COUNT(DISTINCT cm.lead_id) FILTER (WHERE cm.sender = 'ai'),
    COUNT(DISTINCT cm.lead_id) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound')
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM chat_messages cm JOIN leads l ON l.id = cm.lead_id
  WHERE cm.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  -- ===== RESULTADO (ENTRADA ∩ CONVERSÃO) — agendamentos =====
  SELECT
    COUNT(*) FILTER (WHERE a.source = 'ia'),
    COUNT(*) FILTER (WHERE a.source = 'manual'),
    COUNT(*) FILTER (WHERE p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
  INTO v_appt_ia, v_appt_manual, v_appt_total
  FROM appointments a
  LEFT JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR a.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

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
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ) s;

  -- ===== RESULTADO — vendas (ganho/perdido) =====
  SELECT
    COUNT(*) FILTER (WHERE t.outcome = 'ganho'),
    COUNT(*) FILTER (WHERE t.outcome = 'perdido')
  INTO v_won, v_lost
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome IS NOT NULL
    AND (p_conv_from IS NULL OR COALESCE(t.outcome_at, t.closed_at)::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR COALESCE(t.outcome_at, t.closed_at)::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  -- ===== FINANCE =====
  -- faturamento: receita por CONVERSÃO (date) ∩ coorte ENTRADA (via paciente→lead)
  SELECT COALESCE(SUM(ft.amount), 0) INTO v_revenue
  FROM financial_transactions ft
  LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
  WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
    AND (p_conv_from IS NULL OR ft.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR ft.date <= p_conv_to)
    AND ((p_entry_from IS NULL AND p_entry_to IS NULL)
      OR ((p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
          AND (p_entry_to IS NULL OR l.created_at::date <= p_entry_to)));

  -- investimento: só CONVERSÃO (sem coorte); escopo origem por platform
  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM marketing_data
  WHERE clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR date >= p_conv_from) AND (p_conv_to IS NULL OR date <= p_conv_to);

  SELECT COALESCE(SUM(investment), 0) INTO v_investment FROM marketing_data
  WHERE clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR date >= p_conv_from) AND (p_conv_to IS NULL OR date <= p_conv_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND platform = 'meta_ads')
      OR (p_origin = 'google' AND platform = 'google_ads')
      OR (p_origin = 'sem_origem' AND (platform IS NULL OR platform NOT IN ('meta_ads', 'google_ads'))));

  -- ciclo de vendas: ganhos por CONVERSÃO ∩ coorte ENTRADA
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0) INTO v_sales_cycle
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND (p_conv_from IS NULL OR t.outcome_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR t.outcome_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  -- consultas realizadas GERAL (denominador do ticket médio): CONVERSÃO (date) ∩ coorte ENTRADA
  SELECT COUNT(*) INTO v_attended_consults
  FROM appointments a
  LEFT JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id AND a.status IN ('realizado', 'compareceu')
    AND (p_conv_from IS NULL OR a.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to);

  -- valor convertido: conversões por CONVERSÃO (converted_at) ∩ coorte ENTRADA
  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_converted_value
  FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
  WHERE c.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR c.converted_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR c.converted_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to);

  -- ===== automações (CONVERSÃO) + csat (CONVERSÃO) =====
  SELECT COALESCE(jsonb_object_agg(type, cnt), '{}'::jsonb) INTO v_auto
  FROM (
    SELECT al.type, COUNT(*) AS cnt FROM automation_logs al LEFT JOIN leads l ON l.id = al.lead_id
    WHERE al.clinic_id = p_clinic_id AND al.status = 'sent'
      AND (p_conv_from IS NULL OR al.triggered_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR al.triggered_at::date <= p_conv_to)
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY al.type
  ) a;

  SELECT COUNT(*), AVG(csat_score) INTO v_csat_answered, v_csat_avg FROM leads
  WHERE clinic_id = p_clinic_id AND csat_score IS NOT NULL
    AND (p_conv_from IS NULL OR csat_answered_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR csat_answered_at::date <= p_conv_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('score', score, 'count', cnt) ORDER BY score DESC), '[]'::jsonb) INTO v_csat_dist
  FROM (
    SELECT csat_score AS score, COUNT(*) AS cnt FROM leads
    WHERE clinic_id = p_clinic_id AND csat_score IS NOT NULL
      AND (p_conv_from IS NULL OR csat_answered_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR csat_answered_at::date <= p_conv_to)
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND source = 'meta_ads')
        OR (p_origin = 'google' AND source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY csat_score
  ) d;

  -- ===== FUNIL (coorte por ENTRADA: leads criados na janela, etapa alcançada por ticket) =====
  WITH entries AS (
    SELECT h.ticket_id, h.new_stage_id AS stage_id, MAX(h.changed_at) AS last_entry
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id IS NOT NULL AND h.ticket_id IS NOT NULL
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY h.ticket_id, h.new_stage_id
  ),
  counts AS (SELECT stage_id, COUNT(*)::int AS leads FROM entries GROUP BY stage_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage_id', fs.id, 'name', fs.name, 'slug', fs.slug, 'position', fs.position,
    'is_conversion', fs.is_conversion, 'color', fs.color, 'leads', COALESCE(c.leads, 0)) ORDER BY fs.position), '[]'::jsonb)
  INTO v_funnel
  FROM funnel_stages fs LEFT JOIN counts c ON c.stage_id = fs.id
  WHERE fs.clinic_id = p_clinic_id;

  -- ===== TENDÊNCIAS (janela de CONVERSÃO/evento) =====
  WITH dates AS (SELECT generate_series(v_d_from, v_d_to, interval '1 day')::date AS d),
  msgs AS (
    SELECT cm.created_at::date AS d,
      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_msgs,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_msgs
    FROM chat_messages cm LEFT JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id AND cm.created_at::date BETWEEN v_d_from AND v_d_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  ld AS (
    SELECT created_at::date AS d, COUNT(*) AS leads FROM leads
    WHERE clinic_id = p_clinic_id AND created_at::date BETWEEN v_d_from AND v_d_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND source = 'meta_ads')
        OR (p_origin = 'google' AND source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  ap AS (
    SELECT a.date AS d, COUNT(*) AS appts FROM appointments a
    LEFT JOIN tickets t ON t.id = a.ticket_id LEFT JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id AND a.date BETWEEN v_d_from AND v_d_to
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  hd AS (
    SELECT handoff_triggered_at::date AS d, COUNT(*) AS handoffs FROM leads
    WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL AND handoff_triggered_at::date BETWEEN v_d_from AND v_d_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND source = 'meta_ads')
        OR (p_origin = 'google' AND source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
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
    'leads', COALESCE(l.leads, 0), 'appointments', COALESCE(a.appts, 0),
    'handoffs', COALESCE(h.handoffs, 0), 'followups', COALESCE(f.followups, 0)) ORDER BY dates.d)
  INTO v_daily
  FROM dates
  LEFT JOIN msgs m ON m.d = dates.d LEFT JOIN ld l ON l.d = dates.d
  LEFT JOIN ap a ON a.d = dates.d LEFT JOIN hd h ON h.d = dates.d LEFT JOIN fu f ON f.d = dates.d;

  RETURN jsonb_build_object(
    'entry', jsonb_build_object('from', p_entry_from, 'to', p_entry_to),
    'conv', jsonb_build_object('from', p_conv_from, 'to', p_conv_to),
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
      'manual', COALESCE(v_appt_manual,0), 'byStatus', COALESCE(v_appt_status,'{}'::jsonb)),
    'sla', jsonb_build_object('breaches', COALESCE(v_sla_breaches,0), 'pending', COALESCE(v_pending,0),
      'avgFirstResponseMin', ROUND(COALESCE(v_avg_first_response,0),1),
      'medianFirstResponseMin', ROUND(COALESCE(v_median_first_response,0),1), 'slaMinutes', COALESCE(v_sla_minutes,0)),
    'finance', jsonb_build_object('revenue', COALESCE(v_revenue,0), 'investment', COALESCE(v_investment,0),
      'investmentTotal', COALESCE(v_investment_total,0), 'convertedValue', COALESCE(v_converted_value,0),
      'salesCycleDays', ROUND(COALESCE(v_sales_cycle,0),1), 'attendedConsults', COALESCE(v_attended_consults,0)),
    'outcomes', jsonb_build_object('won', COALESCE(v_won,0), 'lost', COALESCE(v_lost,0)),
    'csat', jsonb_build_object('type', COALESCE(v_csat_type,'csat'), 'answered', COALESCE(v_csat_answered,0),
      'avg', v_csat_avg, 'distribution', COALESCE(v_csat_dist,'[]'::jsonb)),
    'funnel', COALESCE(v_funnel,'[]'::jsonb), 'daily', COALESCE(v_daily,'[]'::jsonb),
    'totalLeads', COALESCE(v_total_leads,0), 'newLeads', COALESCE(v_new_leads,0)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_commercial_dashboard(uuid, date, date, date, date, text, text) TO authenticated;
