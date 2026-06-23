-- Exclui leads marcados como "Não Lead" (leads.is_not_lead) de TODAS as métricas.
-- Predicado uniforme COALESCE(l.is_not_lead, false) = false:
--   - FROM leads / JOIN leads (lead obrigatório) -> exclui o não-lead;
--   - LEFT JOIN leads (lead opcional, ex.: appointment/financeiro sem lead) ->
--     mantém a linha sem lead (NULL vira false) e descarta só a de não-lead.
-- Redefine a versão VIVA de cada RPC (corpo obtido via pg_get_functiondef) com o
-- predicado adicionado em cada bloco que referencia leads. Sem leads, nada muda.

-- ============================================================================
-- get_dashboard_stats (Visão Geral)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_clinic_id uuid, p_date_from date, p_date_to date, p_origin text DEFAULT 'todos'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_appointments int;
  v_total_revenue numeric;
  v_pending_revenue numeric;
  v_total_conversions_value numeric;
  v_total_leads int;
  v_new_patients int;
  v_total_sales int;
  v_total_investment numeric;
  v_total_sla_breaches int;
  v_avg_response_time numeric;
  v_avg_sales_cycle numeric;
  v_chart_data jsonb;
BEGIN
  SELECT COUNT(*) INTO v_total_appointments
  FROM appointments a
  LEFT JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id AND a.date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COALESCE(SUM(ft.amount), 0) INTO v_total_revenue
  FROM financial_transactions ft
  LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
  WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
    AND ft.date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COALESCE((SELECT default_ticket_value FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1), 0)
       * (SELECT COUNT(*) FROM appointments a
          LEFT JOIN tickets t ON t.id = a.ticket_id
          LEFT JOIN leads l ON l.id = t.lead_id
          WHERE a.clinic_id = p_clinic_id AND a.date BETWEEN p_date_from AND p_date_to
            AND a.status IN ('pendente','confirmado','compareceu')
            AND COALESCE(l.is_not_lead, false) = false
            AND (p_origin = 'todos'
              OR (p_origin = 'meta' AND l.source = 'meta_ads')
              OR (p_origin = 'google' AND l.source = 'google_ads')
              OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads')))))
    INTO v_pending_revenue;

  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_total_conversions_value
  FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
  WHERE c.clinic_id = p_clinic_id AND c.converted_at::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COUNT(*) INTO v_total_leads FROM leads l
  WHERE l.clinic_id = p_clinic_id AND l.created_at::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COUNT(*) INTO v_new_patients
  FROM patients pt
  LEFT JOIN leads l ON l.converted_patient_id = pt.id AND l.clinic_id = pt.clinic_id
  WHERE pt.clinic_id = p_clinic_id AND pt.created_at::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COUNT(*) INTO v_total_sales FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COALESCE(SUM(investment), 0) INTO v_total_investment FROM marketing_data
  WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND platform = 'meta_ads')
      OR (p_origin = 'google' AND platform = 'google_ads')
      OR (p_origin = 'sem_origem' AND (platform IS NULL OR platform NOT IN ('meta_ads','google_ads'))));

  SELECT COUNT(*) INTO v_total_sla_breaches FROM sla_breaches sb
  LEFT JOIN leads l ON l.id = sb.lead_id
  WHERE sb.clinic_id = p_clinic_id
    AND sb.breached_at::date BETWEEN p_date_from AND p_date_to
    AND NOT (sb.sender = 'ai' AND sb.wait_raw_min > 60)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0)
    INTO v_avg_sales_cycle
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND t.outcome_at::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  WITH stream AS (
    SELECT cm.lead_id, cm.created_at, cm.sender,
      CASE WHEN cm.direction = 'inbound' THEN 'in'
           WHEN cm.direction = 'outbound' THEN 'out'
           ELSE NULL END AS kind
    FROM chat_messages cm
    LEFT JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id
      AND cm.created_at::date BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))))
  ),
  lagged AS (
    SELECT lead_id, created_at, sender, kind,
      LAG(kind)       OVER (PARTITION BY lead_id ORDER BY created_at) AS prev_kind,
      LAG(created_at) OVER (PARTITION BY lead_id ORDER BY created_at) AS prev_at
    FROM stream WHERE kind IS NOT NULL
  ),
  cyc AS (
    SELECT lead_id, prev_at AS in_at,
      GREATEST(0, EXTRACT(EPOCH FROM (created_at - prev_at)) / 60.0) AS raw_min
    FROM lagged
    WHERE kind = 'out' AND prev_kind = 'in'
      AND NOT (sender = 'ai' AND EXTRACT(EPOCH FROM (created_at - prev_at)) / 60.0 > 60)
  ),
  firsts AS (SELECT DISTINCT ON (lead_id) lead_id, raw_min FROM cyc ORDER BY lead_id, in_at)
  SELECT COALESCE((SELECT AVG(raw_min) FROM firsts), 0) INTO v_avg_response_time;

  WITH dates AS (SELECT generate_series(p_date_from, p_date_to, interval '1 day')::date AS d),
  apts AS (SELECT a.date AS date, COUNT(*) as qty FROM appointments a
    LEFT JOIN tickets t ON t.id = a.ticket_id LEFT JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id AND a.date BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))))
    GROUP BY a.date),
  revenue AS (SELECT ft.date AS date, SUM(ft.amount) as total FROM financial_transactions ft
    LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
    WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
      AND ft.date BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))))
    GROUP BY ft.date),
  leads_d AS (SELECT l.created_at::date AS date, COUNT(*) as qty FROM leads l
    WHERE l.clinic_id = p_clinic_id AND l.created_at::date BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))))
    GROUP BY l.created_at::date),
  sales_d AS (SELECT COALESCE(t.outcome_at, t.closed_at)::date AS date, COUNT(*) as qty
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
      AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))))
    GROUP BY COALESCE(t.outcome_at, t.closed_at)::date),
  invest_d AS (SELECT date, SUM(investment) as total FROM marketing_data
    WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND platform = 'meta_ads')
        OR (p_origin = 'google' AND platform = 'google_ads')
        OR (p_origin = 'sem_origem' AND (platform IS NULL OR platform NOT IN ('meta_ads','google_ads'))))
    GROUP BY date)
  SELECT jsonb_agg(
    jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'),
      'agendamentos', COALESCE(a.qty, 0), 'faturamento', COALESCE(r.total, 0),
      'leads', COALESCE(l.qty, 0), 'vendas', COALESCE(s.qty, 0),
      'investimento', COALESCE(i.total, 0)) ORDER BY d)
  INTO v_chart_data
  FROM dates LEFT JOIN apts a ON a.date = dates.d
  LEFT JOIN revenue r ON r.date = dates.d LEFT JOIN leads_d l ON l.date = dates.d
  LEFT JOIN sales_d s ON s.date = dates.d LEFT JOIN invest_d i ON i.date = dates.d;

  RETURN jsonb_build_object(
    'totalAppointments', v_total_appointments, 'totalRevenue', v_total_revenue,
    'pendingRevenue', v_pending_revenue, 'totalConversionsValue', v_total_conversions_value,
    'totalLeads', v_total_leads, 'newPatients', v_new_patients,
    'totalSales', v_total_sales, 'totalInvestment', v_total_investment,
    'totalSlaBreaches', v_total_sla_breaches, 'avgResponseTime', v_avg_response_time,
    'avgSalesCycle', v_avg_sales_cycle,
    'defaultTicket', COALESCE((SELECT default_ticket_value FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1), 0),
    'chartData', COALESCE(v_chart_data, '[]'::jsonb)
  );
END;
$function$;

-- ============================================================================
-- get_commercial_leads (drill-down do painel Comercial)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_commercial_leads(p_clinic_id uuid, p_entry_from date, p_entry_to date, p_conv_from date, p_conv_to date, p_agent text DEFAULT 'todos'::text, p_origin text DEFAULT 'todos'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_rows jsonb;
BEGIN
  WITH base AS (
    SELECT l.id, l.name, l.phone, l.source, l.estimated_value,
           l.created_at, l.last_message_at, l.ai_enabled, l.stage_id
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta'   AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
      AND (p_agent = 'todos' OR EXISTS (
        SELECT 1 FROM chat_messages cm
        WHERE cm.lead_id = l.id AND cm.clinic_id = p_clinic_id
          AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
          AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
          AND ((p_agent = 'ia'     AND cm.sender = 'ai')
            OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound'))
      ))
  ),
  page AS (
    SELECT b.*, COUNT(*) OVER() AS total_count
    FROM base b
    ORDER BY b.created_at DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    COALESCE(MAX(p.total_count), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'phone', p.phone,
      'source', p.source,
      'estimatedValue', p.estimated_value,
      'createdAt', p.created_at,
      'lastMessageAt', p.last_message_at,
      'aiEnabled', p.ai_enabled,
      'stageName', fs.name,
      'stageColor', fs.color,
      'isConversion', fs.is_conversion,
      'outcome', tk.outcome
    ) ORDER BY p.created_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page p
  LEFT JOIN funnel_stages fs ON fs.id = p.stage_id
  LEFT JOIN LATERAL (
    SELECT t.outcome FROM tickets t
    WHERE t.lead_id = p.id
    ORDER BY COALESCE(t.outcome_at, t.closed_at, t.created_at) DESC
    LIMIT 1
  ) tk ON true;

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

-- ============================================================================
-- marketing_funnel_cohort (funil do painel Marketing)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.marketing_funnel_cohort(p_clinic_id uuid, p_start date, p_end date)
 RETURNS TABLE(stage_id uuid, platform text, channel text, entry_date date, leads bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH entries AS (
    SELECT h.ticket_id,
           h.new_stage_id AS stage_id,
           CASE
             WHEN l.source = 'meta_ads'   THEN 'meta_ads'
             WHEN l.source = 'google_ads' THEN 'google_ads'
             ELSE 'no_track'
           END AS platform,
           CASE
             WHEN l.capture_channel = 'forms' THEN 'forms'
             ELSE 'whatsapp'
           END AS channel,
           max(h.changed_at) AS last_entry
    FROM lead_stage_history h
    JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id
      AND h.new_stage_id IS NOT NULL
      AND h.ticket_id IS NOT NULL
      AND COALESCE(l.is_not_lead, false) = false
    GROUP BY h.ticket_id, h.new_stage_id, 3, 4
  )
  SELECT stage_id, platform, channel, (last_entry)::date AS entry_date, count(*)::bigint AS leads
  FROM entries
  WHERE last_entry::date BETWEEN p_start AND p_end
  GROUP BY stage_id, platform, channel, (last_entry)::date;
$function$;

-- ============================================================================
-- get_commercial_dashboard (painel Comercial)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_commercial_dashboard(p_clinic_id uuid, p_entry_from date, p_entry_to date, p_conv_from date, p_conv_to date, p_agent text DEFAULT 'todos'::text, p_origin text DEFAULT 'todos'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ganho_stage_id uuid;
  v_ia_msgs int; v_human_msgs int; v_inbound_msgs int; v_total_msgs int;
  v_ia_leads_touched int; v_human_leads_touched int;
  v_appt_ia int; v_appt_manual int; v_appt_total int; v_appt_status jsonb;
  v_ia_enabled int; v_ia_autonomous int; v_handoffs int;
  v_auto jsonb;
  v_sla_breaches int; v_response_cycles int;
  v_median_first_response numeric; v_avg_response numeric; v_avg_over_breach numeric;
  v_sla_minutes int;
  v_bh jsonb; v_sh int; v_sm int; v_eh int; v_em int; v_days int[]; v_has_bh boolean;
  v_won int; v_lost int;
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
  v_d_from := COALESCE(p_conv_from, p_entry_from, CURRENT_DATE - 29);
  v_d_to   := COALESCE(p_conv_to,   p_entry_to,   CURRENT_DATE);

  SELECT COUNT(*) INTO v_total_leads FROM leads WHERE clinic_id = p_clinic_id AND COALESCE(is_not_lead, false) = false;

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
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COUNT(*) INTO v_handoffs FROM leads l
  WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL
    AND (p_conv_from IS NULL OR handoff_triggered_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR handoff_triggered_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

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
        WHEN (p_agent = 'todos' AND cm.direction = 'outbound')
          OR (p_agent = 'ia' AND cm.sender = 'ai')
          OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound') THEN 'out'
        ELSE NULL
      END AS kind
    FROM chat_messages cm
    JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id
      AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
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
    AND (p_conv_from IS NULL OR sb.breached_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR sb.breached_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
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
    AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  WITH appt_cut AS (
    SELECT DISTINCT ON (t.lead_id) t.lead_id, ap.created_at AS cutoff, ap.source AS appt_source
    FROM appointments ap JOIN tickets t ON t.id = ap.ticket_id
    WHERE ap.clinic_id = p_clinic_id
    ORDER BY t.lead_id, ap.created_at
  ),
  cohort AS (
    SELECT l.id AS lead_id
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
  ),
  per_lead AS (
    SELECT c.lead_id, ac.cutoff, ac.appt_source,
      COUNT(cm.id) FILTER (WHERE cm.sender = 'ai') AS ai_out,
      COUNT(cm.id) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_out
    FROM cohort c
    LEFT JOIN appt_cut ac ON ac.lead_id = c.lead_id
    LEFT JOIN chat_messages cm ON cm.lead_id = c.lead_id
      AND cm.clinic_id = p_clinic_id
      AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
      AND (ac.cutoff IS NULL OR cm.created_at <= ac.cutoff)
    GROUP BY c.lead_id, ac.cutoff, ac.appt_source
  )
  SELECT
    COUNT(*) FILTER (WHERE CASE WHEN (ai_out + human_out) > 0 THEN ai_out >= human_out
                               WHEN appt_source IS NOT NULL THEN appt_source = 'ia'
                               ELSE false END),
    COUNT(*) FILTER (WHERE CASE WHEN (ai_out + human_out) > 0 THEN human_out > ai_out
                               WHEN appt_source IS NOT NULL THEN appt_source <> 'ia'
                               ELSE false END)
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM per_lead;

  v_leads_not_attended := GREATEST(COALESCE(v_new_leads,0) - COALESCE(v_ia_leads_touched,0) - COALESCE(v_human_leads_touched,0), 0);

  SELECT
    COUNT(*) FILTER (WHERE a.source = 'ia'),
    COUNT(*) FILTER (WHERE a.source = 'manual'),
    COUNT(*) FILTER (WHERE p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
  INTO v_appt_ia, v_appt_manual, v_appt_total
  FROM appointments a
  LEFT JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR a.created_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR a.created_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
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
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ) s;

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
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COALESCE(SUM(ft.amount), 0) INTO v_revenue
  FROM financial_transactions ft
  LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
  WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
    AND (p_conv_from IS NULL OR ft.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR ft.date <= p_conv_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND ((p_entry_from IS NULL AND p_entry_to IS NULL)
      OR ((p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
          AND (p_entry_to IS NULL OR l.created_at::date <= p_entry_to)));

  SELECT COALESCE(SUM(ft.amount), 0) INTO v_revenue_scoped
  FROM appointments ap
  JOIN financial_transactions ft ON ft.appointment_id = ap.id AND ft.type = 'receita' AND ft.status = 'pago'
  LEFT JOIN tickets t ON t.id = ap.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE ap.clinic_id = p_clinic_id AND ap.status IN ('realizado','compareceu')
    AND (p_conv_from IS NULL OR ap.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR ap.date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_agent = 'todos' OR (p_agent = 'ia' AND ap.source = 'ia') OR (p_agent = 'humano' AND ap.source = 'manual'))
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

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

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0) INTO v_sales_cycle
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND (p_conv_from IS NULL OR t.outcome_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR t.outcome_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

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

  IF v_agenda_funil THEN
    SELECT COUNT(DISTINCT h.ticket_id) INTO v_appt_total
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id = v_agendado_stage_id
      AND (p_conv_from IS NULL OR h.changed_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR h.changed_at::date <= p_conv_to)
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));
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
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

    v_appt_status := jsonb_build_object('realizado', COALESCE(v_attended_consults, 0), 'faltou', COALESCE(v_falta_cnt, 0));
  END IF;

  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_converted_value
  FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
  WHERE c.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR c.converted_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR c.converted_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false;

  SELECT COALESCE(jsonb_object_agg(type, cnt), '{}'::jsonb) INTO v_auto
  FROM (
    SELECT al.type, COUNT(*) AS cnt FROM automation_logs al LEFT JOIN leads l ON l.id = al.lead_id
    WHERE al.clinic_id = p_clinic_id AND al.status = 'sent'
      AND (p_conv_from IS NULL OR al.triggered_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR al.triggered_at::date <= p_conv_to)
      AND COALESCE(l.is_not_lead, false) = false
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
    AND COALESCE(is_not_lead, false) = false
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
      AND COALESCE(is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND source = 'meta_ads')
        OR (p_origin = 'google' AND source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY csat_score
  ) d;

  WITH entries AS (
    SELECT h.ticket_id, h.new_stage_id AS stage_id, MAX(h.changed_at) AS last_entry
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id IS NOT NULL AND h.ticket_id IS NOT NULL
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
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

  WITH dates AS (SELECT generate_series(v_d_from, v_d_to, interval '1 day')::date AS d),
  msgs AS (
    SELECT cm.created_at::date AS d,
      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_msgs,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_msgs
    FROM chat_messages cm LEFT JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id AND cm.created_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  ld AS (
    SELECT created_at::date AS d, COUNT(*) AS leads FROM leads
    WHERE clinic_id = p_clinic_id AND created_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND source = 'meta_ads')
        OR (p_origin = 'google' AND source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
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
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  rz AS (
    SELECT a.date AS d, COUNT(*) AS realizadas FROM appointments a
    LEFT JOIN tickets t ON t.id = a.ticket_id LEFT JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id AND a.status IN ('realizado', 'compareceu') AND a.date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  rev AS (
    SELECT ap.date AS d, SUM(ft.amount) AS faturamento
    FROM appointments ap
    JOIN financial_transactions ft ON ft.appointment_id = ap.id AND ft.type = 'receita' AND ft.status = 'pago'
    LEFT JOIN tickets t ON t.id = ap.ticket_id LEFT JOIN leads l ON l.id = t.lead_id
    WHERE ap.clinic_id = p_clinic_id AND ap.status IN ('realizado','compareceu')
      AND ap.date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND ap.source = 'ia') OR (p_agent = 'humano' AND ap.source = 'manual'))
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  apf AS (
    SELECT h.changed_at::date AS d, COUNT(DISTINCT h.ticket_id) AS appts
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE v_agenda_funil AND h.clinic_id = p_clinic_id AND h.new_stage_id = v_agendado_stage_id
      AND h.changed_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  rzf AS (
    SELECT h.changed_at::date AS d, COUNT(DISTINCT h.ticket_id) AS realizadas
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE v_agenda_funil AND h.clinic_id = p_clinic_id AND h.new_stage_id = v_ganho_stage_id
      AND h.changed_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  wg AS (
    SELECT COALESCE(t.outcome_at, t.closed_at)::date AS d, COUNT(*) AS ganhos
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
      AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  mkt AS (
    SELECT date AS d, SUM(investment) AS investment FROM marketing_data
    WHERE clinic_id = p_clinic_id AND date BETWEEN v_d_from AND v_d_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND platform = 'meta_ads')
        OR (p_origin = 'google' AND platform = 'google_ads')
        OR (p_origin = 'sem_origem' AND (platform IS NULL OR platform NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  hd AS (
    SELECT handoff_triggered_at::date AS d, COUNT(*) AS handoffs FROM leads
    WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL AND handoff_triggered_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(is_not_lead, false) = false
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
    'outcomes', jsonb_build_object('won', COALESCE(v_won,0), 'lost', COALESCE(v_lost,0)),
    'csat', jsonb_build_object('type', COALESCE(v_csat_type,'csat'), 'answered', COALESCE(v_csat_answered,0),
      'avg', v_csat_avg, 'distribution', COALESCE(v_csat_dist,'[]'::jsonb)),
    'funnel', COALESCE(v_funnel,'[]'::jsonb), 'daily', COALESCE(v_daily,'[]'::jsonb),
    'totalLeads', COALESCE(v_total_leads,0), 'newLeads', COALESCE(v_new_leads,0), 'leadsNotAttended', COALESCE(v_leads_not_attended,0),
    'agendaViaFunil', COALESCE(v_agenda_funil, false)
  );
END;
$function$;
