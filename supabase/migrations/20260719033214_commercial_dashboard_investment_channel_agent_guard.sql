-- 20260719033214_commercial_dashboard_investment_channel_agent_guard
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_commercial_dashboard';

  v_new := v_def;

  -- 1) investimento TOTAL: marketing_data -> view mestra
  v_new := replace(v_new,
$old1$  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM marketing_data
  WHERE clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR date >= p_conv_from) AND (p_conv_to IS NULL OR date <= p_conv_to);$old1$,
$new1$  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM v_kpi_investment
  WHERE clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR day >= p_conv_from) AND (p_conv_to IS NULL OR day <= p_conv_to);$new1$);

  -- 2) investimento ESCOPADO: guard só-balcão -> qualquer filtro de canal/agente; view mestra
  v_new := replace(v_new,
$old2$  SELECT COALESCE(SUM(investment), 0) INTO v_investment FROM marketing_data
  WHERE clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR date >= p_conv_from) AND (p_conv_to IS NULL OR date <= p_conv_to)
    AND (p_origin = 'todos'
      OR (CASE WHEN platform = 'meta_ads' THEN 'meta' WHEN platform = 'google_ads' THEN 'google' WHEN platform = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (string_to_array(COALESCE(p_channel, 'todos'), ',') <> ARRAY['balcao']);$old2$,
$new2$  SELECT COALESCE(SUM(investment), 0) INTO v_investment FROM v_kpi_investment
  WHERE clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR day >= p_conv_from) AND (p_conv_to IS NULL OR day <= p_conv_to)
    AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')))
    AND COALESCE(p_channel, 'todos') = 'todos' AND COALESCE(p_agent, 'todos') = 'todos';$new2$);

  -- 3) investimento DIÁRIO (gráfico): mesmo guard + view mestra
  v_new := replace(v_new,
$old3$    SELECT date AS d, SUM(investment) AS investment FROM marketing_data
    WHERE clinic_id = p_clinic_id AND date BETWEEN v_d_from AND v_d_to
      AND (p_origin = 'todos'
        OR (CASE WHEN platform = 'meta_ads' THEN 'meta' WHEN platform = 'google_ads' THEN 'google' WHEN platform = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (string_to_array(COALESCE(p_channel, 'todos'), ',') <> ARRAY['balcao'])
    GROUP BY 1$old3$,
$new3$    SELECT day AS d, SUM(investment) AS investment FROM v_kpi_investment
    WHERE clinic_id = p_clinic_id AND day BETWEEN v_d_from AND v_d_to
      AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')))
      AND COALESCE(p_channel, 'todos') = 'todos' AND COALESCE(p_agent, 'todos') = 'todos'
    GROUP BY 1$new3$);

  -- asserções
  IF v_new = v_def THEN RAISE EXCEPTION 'nenhuma substituicao aplicada'; END IF;
  IF position('INTO v_investment_total FROM v_kpi_investment' in v_new) = 0 THEN RAISE EXCEPTION 'span 1 falhou'; END IF;
  IF position('INTO v_investment FROM v_kpi_investment' in v_new) = 0 THEN RAISE EXCEPTION 'span 2 falhou'; END IF;
  IF position('SELECT day AS d, SUM(investment) AS investment FROM v_kpi_investment' in v_new) = 0 THEN RAISE EXCEPTION 'span 3 falhou'; END IF;
  IF position($chk$<> ARRAY['balcao']$chk$ in v_new) > 0 THEN RAISE EXCEPTION 'guard antigo de balcao ainda presente'; END IF;

  EXECUTE v_new;
END $mig$;
