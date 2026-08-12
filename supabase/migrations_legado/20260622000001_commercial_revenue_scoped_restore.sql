-- Painel Comercial — RESTAURA o Faturamento Real escopado (revenueScoped), perdido numa regressão.
--
-- Contexto: o fix `revenue_scoped` (devolve finance.revenueScoped, ancorado nas CONSULTAS REALIZADAS e
-- escopado por origem/agente) foi aplicado em 18/06 de manhã e depois SOBRESCRITO por três migrations da
-- tarde (daily_result_metrics / daily_investment / agenda_via_funil) que fazem CREATE OR REPLACE da função
-- inteira com o v_revenue ANTIGO (sem escopo de origem nem agente). Resultado: o Faturamento Real ficava
-- idêntico em Meta/Google/Todos e desalinhado de "Consultas Realizadas".
--
-- Esta migration repatcha a função AO VIVO (via pg_get_functiondef + replace, mesmo padrão da 000006):
--   1) declara v_revenue_scoped;
--   2) calcula a receita ancorada nas consultas realizado/compareceu (via appointment_id), por data da
--      consulta (ap.date), respeitando origem (l.source) e agente (ap.source);
--   3) escopa também a CTE diária `rev` (gráfico de Tendências) da mesma forma;
--   4) retorna finance.revenueScoped (mantém finance.revenue por compatibilidade).
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  -- 1) declarar v_revenue_scoped
  src := replace(src,
$d_old$v_revenue numeric; v_investment numeric;$d_old$,
$d_new$v_revenue numeric; v_revenue_scoped numeric; v_investment numeric;$d_new$);

  -- 2) calcular v_revenue_scoped logo antes do investimento total
  src := replace(src,
$rs_old$  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM marketing_data$rs_old$,
$rs_new$  SELECT COALESCE(SUM(ft.amount), 0) INTO v_revenue_scoped
  FROM appointments ap
  JOIN financial_transactions ft ON ft.appointment_id = ap.id AND ft.type = 'receita' AND ft.status = 'pago'
  LEFT JOIN tickets t ON t.id = ap.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE ap.clinic_id = p_clinic_id AND ap.status IN ('realizado','compareceu')
    AND (p_conv_from IS NULL OR ap.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR ap.date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_agent = 'todos' OR (p_agent = 'ia' AND ap.source = 'ia') OR (p_agent = 'humano' AND ap.source = 'manual'))
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM marketing_data$rs_new$);

  -- 3) CTE diária `rev`: ancorar nas consultas realizadas + escopo origem/agente
  src := replace(src,
$rev_old$  rev AS (
    SELECT ft.date AS d, SUM(ft.amount) AS faturamento FROM financial_transactions ft
    WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
      AND ft.date BETWEEN v_d_from AND v_d_to
    GROUP BY 1
  ),$rev_old$,
$rev_new$  rev AS (
    SELECT ap.date AS d, SUM(ft.amount) AS faturamento
    FROM appointments ap
    JOIN financial_transactions ft ON ft.appointment_id = ap.id AND ft.type = 'receita' AND ft.status = 'pago'
    LEFT JOIN tickets t ON t.id = ap.ticket_id LEFT JOIN leads l ON l.id = t.lead_id
    WHERE ap.clinic_id = p_clinic_id AND ap.status IN ('realizado','compareceu')
      AND ap.date BETWEEN v_d_from AND v_d_to
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND ap.source = 'ia') OR (p_agent = 'humano' AND ap.source = 'manual'))
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),$rev_new$);

  -- 4) retornar finance.revenueScoped
  src := replace(src,
$f_old$'finance', jsonb_build_object('revenue', COALESCE(v_revenue,0),$f_old$,
$f_new$'finance', jsonb_build_object('revenue', COALESCE(v_revenue,0), 'revenueScoped', COALESCE(v_revenue_scoped,0),$f_new$);

  EXECUTE src;
END $do$;
