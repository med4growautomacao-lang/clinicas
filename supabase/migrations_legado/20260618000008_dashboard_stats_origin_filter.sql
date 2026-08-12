-- Visão Geral / Painel Administrativo agora aceita filtro de ORIGEM (Todos/Meta/Google/Orgânico).
-- get_dashboard_stats ganha o parâmetro p_origin (default 'todos') e filtra todas as métricas:
--   - métricas baseadas em lead (appointments via ticket->lead, leads, vendas, conversões,
--     receita via patient->lead, a receber via ticket->lead, novos pacientes, SLA, ciclo, resposta)
--     por lead.source (meta_ads / google_ads / orgânico = demais/nulo);
--   - investimento por marketing_data.platform.
-- p_origin tem DEFAULT 'todos' => chamadas antigas (3 args) seguem funcionando.
DROP FUNCTION IF EXISTS public.get_dashboard_stats(uuid,date,date);

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_clinic_id uuid, p_date_from date, p_date_to date, p_origin text DEFAULT 'todos')
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
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COALESCE(SUM(ft.amount), 0) INTO v_total_revenue
  FROM financial_transactions ft
  LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
  WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
    AND ft.date BETWEEN p_date_from AND p_date_to
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
            AND (p_origin = 'todos'
              OR (p_origin = 'meta' AND l.source = 'meta_ads')
              OR (p_origin = 'google' AND l.source = 'google_ads')
              OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads')))))
    INTO v_pending_revenue;

  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_total_conversions_value
  FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
  WHERE c.clinic_id = p_clinic_id AND c.converted_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COUNT(*) INTO v_total_leads FROM leads l
  WHERE l.clinic_id = p_clinic_id AND l.created_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COUNT(*) INTO v_new_patients
  FROM patients pt
  LEFT JOIN leads l ON l.converted_patient_id = pt.id AND l.clinic_id = pt.clinic_id
  WHERE pt.clinic_id = p_clinic_id AND pt.created_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COUNT(*) INTO v_total_sales FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to
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
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))));

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0)
    INTO v_avg_sales_cycle
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND t.outcome_at::date BETWEEN p_date_from AND p_date_to
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
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))))
    GROUP BY a.date),
  revenue AS (SELECT ft.date AS date, SUM(ft.amount) as total FROM financial_transactions ft
    LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
    WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
      AND ft.date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))))
    GROUP BY ft.date),
  leads_d AS (SELECT l.created_at::date AS date, COUNT(*) as qty FROM leads l
    WHERE l.clinic_id = p_clinic_id AND l.created_at::date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads','google_ads'))))
    GROUP BY l.created_at::date),
  sales_d AS (SELECT COALESCE(t.outcome_at, t.closed_at)::date AS date, COUNT(*) as qty
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
      AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to
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
    'avgSalesCycle', v_avg_sales_cycle, 'chartData', COALESCE(v_chart_data, '[]'::jsonb)
  );
END;
$function$;
