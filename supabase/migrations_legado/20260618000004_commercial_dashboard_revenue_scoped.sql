-- "Faturamento Real" do painel comercial deve acompanhar os filtros (agente/origem),
-- igual a "Consultas Realizadas". Antes, finance.revenue só aplicava a coorte de Entrada
-- (ignorava agente/origem) — então 1 consulta no recorte mostrava o faturamento de TODAS
-- as consultas da coorte (ex.: 1 consulta IA+Google => R$3.600 em vez de R$600).
--
-- Adiciona finance.revenueScoped = receita (receita/pago) filtrada por:
--   - agente: via appointment.source (ia/manual) — exige a receita estar ligada à consulta;
--   - origem: via lead.source (meta/google/orgânico);
--   - coorte de Entrada (lead.created_at) e janela de Conversão (ft.date).
-- Mantém finance.revenue (geral, só coorte+conversão) para o ROAS Real.
--
-- Edição cirúrgica via pg_get_functiondef + replace para não reescrever a função inteira.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  src := replace(src,
    $a$v_revenue numeric; v_investment numeric; v_investment_total numeric;$a$,
    $a$v_revenue numeric; v_revenue_scoped numeric; v_investment numeric; v_investment_total numeric;$a$);

  src := replace(src,
    $a$  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM marketing_data$a$,
    $b$  SELECT COALESCE(SUM(ft.amount), 0) INTO v_revenue_scoped
  FROM financial_transactions ft
  LEFT JOIN appointments ap ON ap.id = ft.appointment_id
  LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
  WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
    AND (p_conv_from IS NULL OR ft.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR ft.date <= p_conv_to)
    AND ((p_entry_from IS NULL AND p_entry_to IS NULL)
      OR ((p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
          AND (p_entry_to IS NULL OR l.created_at::date <= p_entry_to)))
    AND (p_agent = 'todos' OR (p_agent = 'ia' AND ap.source = 'ia') OR (p_agent = 'humano' AND ap.source = 'manual'))
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM marketing_data$b$);

  src := replace(src,
    $a$'revenue', COALESCE(v_revenue,0), 'investment',$a$,
    $a$'revenue', COALESCE(v_revenue,0), 'revenueScoped', COALESCE(v_revenue_scoped,0), 'investment',$a$);

  EXECUTE src;
END $do$;
