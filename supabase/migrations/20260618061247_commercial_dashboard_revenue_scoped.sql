-- 20260618061247_commercial_dashboard_revenue_scoped
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adiciona finance.revenueScoped ao get_commercial_dashboard: faturamento real
-- filtrado por agente (appointment.source) + origem (lead.source) + coorte, para
-- ficar consistente com "Consultas realizadas". Mantém finance.revenue (geral) p/ ROAS.
-- Edição cirúrgica via pg_get_functiondef + replace para não reescrever a função inteira.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  -- 1) nova variável
  src := replace(src,
    $a$v_revenue numeric; v_investment numeric; v_investment_total numeric;$a$,
    $a$v_revenue numeric; v_revenue_scoped numeric; v_investment numeric; v_investment_total numeric;$a$);

  -- 2) cálculo do revenue escopado (inserido antes do SELECT de investment_total)
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

  -- 3) expõe revenueScoped no JSON
  src := replace(src,
    $a$'revenue', COALESCE(v_revenue,0), 'investment',$a$,
    $a$'revenue', COALESCE(v_revenue,0), 'revenueScoped', COALESCE(v_revenue_scoped,0), 'investment',$a$);

  EXECUTE src;
END $do$;
