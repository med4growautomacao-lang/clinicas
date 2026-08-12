-- 20260618063426_dashboard_a_receber_projecao_agendamentos
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- "A Receber" da Visão Geral passa a ser uma PROJEÇÃO: ticket configurado
-- (ai_config.default_ticket_value) × nº de agendamentos no período (por data do evento)
-- com status pendente/confirmado/compareceu. realizado = já recebido; faltou/cancelado fora.
-- Antes era a soma de transações financeiras pendentes (quase sempre 0).
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_dashboard_stats(uuid,date,date)'::regprocedure);

  src := replace(src,
$old$  SELECT COALESCE(SUM(amount), 0) INTO v_pending_revenue FROM financial_transactions
  WHERE clinic_id = p_clinic_id AND type = 'receita' AND status = 'pendente'
    AND date BETWEEN p_date_from AND p_date_to;$old$,
$new$  SELECT COALESCE((SELECT default_ticket_value FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1), 0)
       * (SELECT COUNT(*) FROM appointments
          WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to
            AND status IN ('pendente','confirmado','compareceu'))
    INTO v_pending_revenue;$new$);

  EXECUTE src;
END $do$;
