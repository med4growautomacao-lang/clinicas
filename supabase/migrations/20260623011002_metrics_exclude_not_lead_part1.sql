-- 20260623011002_metrics_exclude_not_lead_part1
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- get_dashboard_stats (Visão Geral)
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

-- get_commercial_leads (drill-down do painel Comercial)
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

-- marketing_funnel_cohort (funil do painel Marketing)
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
