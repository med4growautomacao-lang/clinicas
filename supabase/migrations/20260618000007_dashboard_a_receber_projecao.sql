-- Visão Geral / Painel Administrativo: "A Receber" passa a ser uma PROJEÇÃO de pipeline,
-- não a soma de transações financeiras pendentes (que era ~0).
--
-- A Receber = ticket configurado (ai_config.default_ticket_value)
--             × nº de agendamentos no período (por data do evento) com status
--               pendente / confirmado / compareceu.
-- realizado = já recebido (entra em "Recebido"); faltou / cancelado = não contam.
--
-- Edição cirúrgica via pg_get_functiondef + replace.
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
