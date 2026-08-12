-- 20260718212506_get_dashboard_stats_drop_financial
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- get_dashboard_stats: remove o único pull restante de financial_transactions
-- (v_total_revenue) — módulo financeiro desabilitado pelo dono. O front já lê salesValue
-- (vendas lançadas), então totalRevenue vira 0 (a ser removido de vez na limpeza).
DO $do$
DECLARE v text; n int;
BEGIN
  v := pg_get_functiondef('public.get_dashboard_stats(uuid,date,date,text,text,text)'::regprocedure);
  v := regexp_replace(v,
    'SELECT COALESCE\(SUM\(ft\.amount\), 0\) INTO v_total_revenue.*?v\.agent = p_agent\)\);',
    'v_total_revenue := 0; -- financeiro desabilitado', '');
  n := (length(v) - length(replace(v, 'financial_transactions', ''))) / length('financial_transactions');
  IF n > 0 THEN RAISE EXCEPTION 'ainda restam % refs a financial_transactions', n; END IF;
  EXECUTE v;
END
$do$;
