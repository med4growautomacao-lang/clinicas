-- 20260618071741_dashboard_stats_return_default_ticket
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Expõe o ticket configurado (ai_config.default_ticket_value) no get_dashboard_stats,
-- para a Visão Geral mostrar "Ticket Médio" puxando do config (não Receita÷Vendas).
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_dashboard_stats(uuid,date,date,text)'::regprocedure);

  src := replace(src,
$a$    'avgSalesCycle', v_avg_sales_cycle, 'chartData', COALESCE(v_chart_data, '[]'::jsonb)$a$,
$a$    'avgSalesCycle', v_avg_sales_cycle,
    'defaultTicket', COALESCE((SELECT default_ticket_value FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1), 0),
    'chartData', COALESCE(v_chart_data, '[]'::jsonb)$a$);

  EXECUTE src;
END $do$;
