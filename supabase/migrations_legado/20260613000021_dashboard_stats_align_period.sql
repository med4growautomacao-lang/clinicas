-- Alinha a Visão Geral (get_dashboard_stats) ao princípio "por período" e corrige 2 pontos:
--  1) Tempo de resposta: ANTES media handoff_triggered_at - created_at (criação→handoff = dias).
--     AGORA usa a MESMA lógica do painel Comercial: média do 1º ciclo in->out por lead
--     (chat_messages), por período (data da msg), com teto de 1h só p/ IA.
--  2) Agendamentos: ANTES contava por created_at (quando foi marcado). AGORA conta pela
--     DATA da consulta (alinha com o calendário do painel). Idem no chartData.
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_clinic_id uuid, p_date_from date, p_date_to date)
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
  -- Agendamentos: por DATA da consulta (não por created_at)
  SELECT COUNT(*) INTO v_total_appointments FROM appointments
  WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_revenue FROM financial_transactions
  WHERE clinic_id = p_clinic_id AND type = 'receita' AND status = 'pago'
    AND date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(amount), 0) INTO v_pending_revenue FROM financial_transactions
  WHERE clinic_id = p_clinic_id AND type = 'receita' AND status = 'pendente'
    AND date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(value::numeric), 0) INTO v_total_conversions_value FROM conversions
  WHERE clinic_id = p_clinic_id AND converted_at::date BETWEEN p_date_from AND p_date_to;

  SELECT COUNT(*) INTO v_total_leads FROM leads
  WHERE clinic_id = p_clinic_id AND created_at::date BETWEEN p_date_from AND p_date_to;

  SELECT COUNT(*) INTO v_new_patients FROM patients
  WHERE clinic_id = p_clinic_id AND created_at::date BETWEEN p_date_from AND p_date_to;

  SELECT COUNT(*) INTO v_total_sales FROM tickets t
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(investment), 0) INTO v_total_investment FROM marketing_data
  WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to;

  -- ESTOUROS DE SLA: eventos (sla_breaches) por DATA DO ESTOURO (breached_at); teto de 1h só p/ IA
  SELECT COUNT(*) INTO v_total_sla_breaches FROM sla_breaches sb
  WHERE sb.clinic_id = p_clinic_id
    AND sb.breached_at::date BETWEEN p_date_from AND p_date_to
    AND NOT (sb.sender = 'ai' AND sb.wait_raw_min > 60);

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0)
    INTO v_avg_sales_cycle
  FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND t.outcome_at::date BETWEEN p_date_from AND p_date_to;

  -- Tempo de resposta = média do 1º ciclo in->out por lead (mesma lógica do painel Comercial),
  -- por período (data da mensagem); teto de 1h só p/ IA.
  WITH stream AS (
    SELECT cm.lead_id, cm.created_at, cm.sender,
      CASE WHEN cm.direction = 'inbound' THEN 'in'
           WHEN cm.direction = 'outbound' THEN 'out'
           ELSE NULL END AS kind
    FROM chat_messages cm
    WHERE cm.clinic_id = p_clinic_id
      AND cm.created_at::date BETWEEN p_date_from AND p_date_to
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
  apts AS (SELECT date, COUNT(*) as qty FROM appointments
    WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to
    GROUP BY date),
  revenue AS (SELECT date, SUM(amount) as total FROM financial_transactions
    WHERE clinic_id = p_clinic_id AND type = 'receita' AND status = 'pago'
      AND date BETWEEN p_date_from AND p_date_to GROUP BY date),
  leads_d AS (SELECT created_at::date AS date, COUNT(*) as qty FROM leads
    WHERE clinic_id = p_clinic_id AND created_at::date BETWEEN p_date_from AND p_date_to GROUP BY created_at::date),
  sales_d AS (SELECT COALESCE(t.outcome_at, t.closed_at)::date AS date, COUNT(*) as qty
    FROM tickets t
    WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
      AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to
    GROUP BY COALESCE(t.outcome_at, t.closed_at)::date),
  invest_d AS (SELECT date, SUM(investment) as total FROM marketing_data
    WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to GROUP BY date)
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
