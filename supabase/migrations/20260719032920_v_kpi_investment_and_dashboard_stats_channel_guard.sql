-- 20260719032920_v_kpi_investment_and_dashboard_stats_channel_guard
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Passo 1: view mestra do investimento (fonte única do mapeamento plataforma→origem).
CREATE OR REPLACE VIEW public.v_kpi_investment
WITH (security_invoker = on) AS
SELECT
  md.clinic_id,
  md.date AS day,
  md.platform,
  CASE WHEN md.platform = 'meta_ads'   THEN 'meta'
       WHEN md.platform = 'google_ads' THEN 'google'
       WHEN md.platform = 'balcao'     THEN 'balcao'
       ELSE 'sem_origem' END AS origin,
  md.investment
FROM public.marketing_data md;

-- Passo 2: get_dashboard_stats (VG) lê a view e retorna investimento NULL quando há
-- filtro de CANAL ou AGENTE ativo (o gasto de mídia não é atribuível a esses recortes).
CREATE OR REPLACE FUNCTION public.get_dashboard_stats(p_clinic_id uuid, p_date_from date, p_date_to date, p_origin text DEFAULT 'todos'::text, p_channel text DEFAULT 'todos'::text, p_agent text DEFAULT 'todos'::text)
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
  -- AGENDADOS: união agendamento∪etapa (v_kpi_scheduled), por data de virou-agendado.
  SELECT COUNT(*) INTO v_total_appointments
  FROM v_kpi_scheduled sc
  JOIN leads l ON l.id = sc.lead_id
  WHERE sc.clinic_id = p_clinic_id AND sc.day BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  -- (mantido p/ compat/rollback) Recebido em caixa = financeiro pago.
  v_total_revenue := 0; -- financeiro desabilitado

  SELECT COALESCE((SELECT default_ticket_value FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1), 0)
       * (SELECT COUNT(*) FROM appointments a
          LEFT JOIN tickets t ON t.id = a.ticket_id
          LEFT JOIN leads l ON l.id = t.lead_id
          WHERE a.clinic_id = p_clinic_id AND a.date BETWEEN p_date_from AND p_date_to
            AND a.status IN ('pendente','confirmado','compareceu')
            AND COALESCE(l.is_not_lead, false) = false
            AND (p_origin = 'todos'
              OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent)))
    INTO v_pending_revenue;

  -- VENDAS LANÇADAS (faturamento canônico): conversions EXCLUINDO 'Orçamento Enviado'.
  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_total_conversions_value
  FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
  WHERE c.clinic_id = p_clinic_id AND c.converted_at::date BETWEEN p_date_from AND p_date_to
    AND c.description IS DISTINCT FROM 'Orçamento Enviado'
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  SELECT COUNT(*) INTO v_total_leads FROM leads l
  WHERE l.clinic_id = p_clinic_id AND l.created_at::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  SELECT COUNT(*) INTO v_new_patients
  FROM patients pt
  LEFT JOIN leads l ON l.converted_patient_id = pt.id AND l.clinic_id = pt.clinic_id
  WHERE pt.clinic_id = p_clinic_id AND pt.created_at::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  SELECT COUNT(*) INTO v_total_sales FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  -- INVESTIMENTO: só é atribuível sem filtro de canal/agente (gasto é por plataforma).
  -- Com canal ou agente ativo → NULL (o front exibe "—"). Lê a view mestra v_kpi_investment.
  IF p_channel = 'todos' AND p_agent = 'todos' THEN
    SELECT COALESCE(SUM(investment), 0) INTO v_total_investment FROM v_kpi_investment
    WHERE clinic_id = p_clinic_id AND day BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')));
  ELSE
    v_total_investment := NULL;
  END IF;

  SELECT COUNT(*) INTO v_total_sla_breaches FROM sla_breaches sb
  LEFT JOIN leads l ON l.id = sb.lead_id
  WHERE sb.clinic_id = p_clinic_id
    AND sb.breached_at::date BETWEEN p_date_from AND p_date_to
    AND NOT (sb.sender = 'ai' AND sb.wait_raw_min > 60)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0)
    INTO v_avg_sales_cycle
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND t.outcome_at::date BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

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
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
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
  apts AS (SELECT sc.day AS date, COUNT(*) as qty FROM v_kpi_scheduled sc
    JOIN leads l ON l.id = sc.lead_id
    WHERE sc.clinic_id = p_clinic_id AND sc.day BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    GROUP BY sc.day),
  revenue AS (SELECT c.converted_at::date AS date, SUM(c.value::numeric) as total FROM conversions c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
      AND c.converted_at::date BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    GROUP BY c.converted_at::date),
  leads_d AS (SELECT l.created_at::date AS date, COUNT(*) as qty FROM leads l
    WHERE l.clinic_id = p_clinic_id AND l.created_at::date BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    GROUP BY l.created_at::date),
  sales_d AS (SELECT COALESCE(t.outcome_at, t.closed_at)::date AS date, COUNT(*) as qty
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
      AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    GROUP BY COALESCE(t.outcome_at, t.closed_at)::date),
  invest_d AS (SELECT day AS date, SUM(investment) as total FROM v_kpi_investment
    WHERE clinic_id = p_clinic_id AND day BETWEEN p_date_from AND p_date_to
      AND p_channel = 'todos' AND p_agent = 'todos'
      AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')))
    GROUP BY day)
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
    'salesValue', v_total_conversions_value,
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
