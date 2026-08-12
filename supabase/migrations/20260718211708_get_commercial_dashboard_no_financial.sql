-- 20260718211708_get_commercial_dashboard_no_financial
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Comercial: remove os 3 pulls de financial_transactions (módulo desabilitado pelo dono)
-- e passa faturamento a VENDAS LANÇADAS (conversions sem 'Orçamento Enviado'). Método
-- seguro: re-busca a função no servidor e troca só 3 spans via regexp_replace; assert de
-- que não sobra financeiro antes de recriar. Atribuição do v_revenue_scoped usa a regra
-- nova (vw_lead_agent_class → lead_kpi_attribution).
DO $do$
DECLARE v text; n int;
BEGIN
  v := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text,date,date)'::regprocedure);

  -- #1 v_revenue (financeiro total) -> conversions total
  v := regexp_replace(v,
    'SELECT COALESCE\(SUM\(ft\.amount\), 0\) INTO v_revenue\n[^;]*;',
$r1$SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_revenue
  FROM conversions c
  LEFT JOIN leads l ON l.id = c.lead_id
  WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
    AND (p_conv_from IS NULL OR c.converted_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR c.converted_at::date <= p_conv_to)
    AND (l.id IS NULL OR COALESCE(l.is_not_lead, false) = false)
    AND ((p_entry_from IS NULL AND p_entry_to IS NULL)
      OR ((p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
          AND (p_entry_to IS NULL OR l.created_at::date <= p_entry_to)));$r1$, '');

  -- #2 v_revenue_scoped (financeiro realizado) -> conversions escopado (agente=regra nova)
  v := regexp_replace(v,
    'SELECT COALESCE\(SUM\(ft\.amount\), 0\) INTO v_revenue_scoped\n[^;]*;',
$r2$SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_revenue_scoped
  FROM conversions c
  LEFT JOIN leads l ON l.id = c.lead_id
  WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
    AND (p_conv_from IS NULL OR c.converted_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR c.converted_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (l.id IS NULL OR COALESCE(l.is_not_lead, false) = false)
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    AND (p_origin = 'todos'
      OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));$r2$, '');

  -- #3 gráfico diário (rev) -> conversions por converted_at
  v := regexp_replace(v,
    'SELECT ap\.date AS d, SUM\(ft\.amount\) AS faturamento.*?GROUP BY 1',
$r3$SELECT c.converted_at::date AS d, SUM(c.value::numeric) AS faturamento
    FROM conversions c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
      AND c.converted_at::date BETWEEN v_d_from AND v_d_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ','))) GROUP BY 1$r3$, '');

  n := (length(v) - length(replace(v, 'financial_transactions', ''))) / length('financial_transactions');
  IF n > 0 THEN RAISE EXCEPTION 'ainda restam % refs a financial_transactions', n; END IF;

  EXECUTE v;
END
$do$;
