-- 20260512025500_rpc_get_dashboard_stats
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_clinic_id uuid,
  p_date_from date,
  p_date_to date
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_stage_id uuid;
  v_total_appointments int;
  v_total_revenue numeric;
  v_total_leads int;
  v_new_patients int;
  v_total_sales int;
  v_total_investment numeric;
  v_total_sla_breaches int;
  v_avg_response_time numeric;
  v_avg_sales_cycle numeric;
  v_chart_data jsonb;
BEGIN
  -- Stage de conversão
  SELECT id INTO v_conv_stage_id
  FROM funnel_stages
  WHERE clinic_id = p_clinic_id AND is_fixed = true
  LIMIT 1;

  -- Totais simples
  SELECT COUNT(*) INTO v_total_appointments
  FROM appointments
  WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_revenue
  FROM financial_transactions
  WHERE clinic_id = p_clinic_id AND type = 'receita' AND status = 'pago'
    AND date BETWEEN p_date_from AND p_date_to;

  SELECT COUNT(*) INTO v_total_leads
  FROM leads
  WHERE clinic_id = p_clinic_id
    AND created_at::date BETWEEN p_date_from AND p_date_to;

  SELECT COUNT(*) INTO v_new_patients
  FROM patients
  WHERE clinic_id = p_clinic_id
    AND created_at::date BETWEEN p_date_from AND p_date_to;

  SELECT COUNT(*) INTO v_total_sales
  FROM leads
  WHERE clinic_id = p_clinic_id AND stage_id = v_conv_stage_id
    AND created_at::date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(investment), 0) INTO v_total_investment
  FROM marketing_data
  WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(sla_breach_count), 0) INTO v_total_sla_breaches
  FROM leads
  WHERE clinic_id = p_clinic_id
    AND created_at::date BETWEEN p_date_from AND p_date_to;

  -- Ciclo de vendas: média de dias entre criação do lead e mudança pra conversão
  SELECT COALESCE(
    AVG(EXTRACT(EPOCH FROM (h.changed_at - l.created_at)) / 86400.0),
    0
  ) INTO v_avg_sales_cycle
  FROM lead_stage_history h
  JOIN leads l ON l.id = h.lead_id
  WHERE h.clinic_id = p_clinic_id
    AND h.new_stage_id = v_conv_stage_id
    AND h.changed_at::date BETWEEN p_date_from AND p_date_to;

  -- Tempo médio de resposta (minutos) — leads com handoff_triggered_at preenchido
  SELECT COALESCE(
    AVG(EXTRACT(EPOCH FROM (handoff_triggered_at - created_at)) / 60.0),
    0
  ) INTO v_avg_response_time
  FROM leads
  WHERE clinic_id = p_clinic_id
    AND handoff_triggered_at IS NOT NULL
    AND created_at::date BETWEEN p_date_from AND p_date_to;

  -- ChartData: série temporal dia-a-dia
  WITH dates AS (
    SELECT generate_series(p_date_from, p_date_to, interval '1 day')::date AS d
  ),
  apts AS (
    SELECT date, COUNT(*) as qty FROM appointments
    WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to
    GROUP BY date
  ),
  revenue AS (
    SELECT date, SUM(amount) as total FROM financial_transactions
    WHERE clinic_id = p_clinic_id AND type = 'receita' AND status = 'pago'
      AND date BETWEEN p_date_from AND p_date_to
    GROUP BY date
  ),
  leads_d AS (
    SELECT created_at::date AS date, COUNT(*) as qty FROM leads
    WHERE clinic_id = p_clinic_id
      AND created_at::date BETWEEN p_date_from AND p_date_to
    GROUP BY created_at::date
  ),
  sales_d AS (
    SELECT created_at::date AS date, COUNT(*) as qty FROM leads
    WHERE clinic_id = p_clinic_id AND stage_id = v_conv_stage_id
      AND created_at::date BETWEEN p_date_from AND p_date_to
    GROUP BY created_at::date
  ),
  invest_d AS (
    SELECT date, SUM(investment) as total FROM marketing_data
    WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to
    GROUP BY date
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'date', to_char(d, 'YYYY-MM-DD'),
      'agendamentos', COALESCE(a.qty, 0),
      'faturamento', COALESCE(r.total, 0),
      'leads', COALESCE(l.qty, 0),
      'vendas', COALESCE(s.qty, 0),
      'investimento', COALESCE(i.total, 0)
    ) ORDER BY d
  )
  INTO v_chart_data
  FROM dates
  LEFT JOIN apts a ON a.date = dates.d
  LEFT JOIN revenue r ON r.date = dates.d
  LEFT JOIN leads_d l ON l.date = dates.d
  LEFT JOIN sales_d s ON s.date = dates.d
  LEFT JOIN invest_d i ON i.date = dates.d;

  RETURN jsonb_build_object(
    'totalAppointments', v_total_appointments,
    'totalRevenue', v_total_revenue,
    'totalLeads', v_total_leads,
    'newPatients', v_new_patients,
    'totalSales', v_total_sales,
    'totalInvestment', v_total_investment,
    'totalSlaBreaches', v_total_sla_breaches,
    'avgResponseTime', v_avg_response_time,
    'avgSalesCycle', v_avg_sales_cycle,
    'chartData', COALESCE(v_chart_data, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid, date, date) TO anon, authenticated, service_role;
