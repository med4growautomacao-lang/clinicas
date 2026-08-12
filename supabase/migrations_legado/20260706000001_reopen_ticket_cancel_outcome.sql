-- 20260706000001_reopen_ticket_cancel_outcome.sql
--
-- Contexto
-- --------
-- No Kanban, ao arrastar um card já resolvido (venda/perda) para uma etapa ATIVA, o app
-- agora pergunta "Manter" x "Cancelar" (ReopenChoiceModal):
--   - Manter: segue o move_lead_stage atual (novo ciclo — preserva a venda/perda e abre um
--     ticket novo; o ticket resolvido vira 'closed' e some do board). NÃO usa esta RPC.
--   - Cancelar: DESFAZ o desfecho no MESMO ticket e o move para a etapa-alvo. É o que esta
--     RPC faz. Antes não existia caminho de "reabrir" — move_lead_stage sempre forçava novo
--     ciclo em ticket resolvido.
--
-- Como funciona o "cancelar"
-- --------------------------
-- 1) Reconcilia uq_tickets_one_open_per_lead (UNIQUE(lead_id) WHERE status='open'): fecha
--    qualquer OUTRO ticket aberto do lead antes de reabrir este.
-- 2) VENDA (outcome='ganho'): limpa a receita para os dashboards não divergirem —
--    a) IDs com vínculo CONFIÁVEL (espelha fn_cascade_delete_ticket_ganho): receita via
--       conversion.financial_transaction_id e via appointment.ticket_id;
--    b) MELHOR-ESFORÇO para vendas manuais (GanhoModal cria a conversão sem ticket_id e a
--       financial_transaction sem vínculo): para cada conversão desta venda, casa 1 lançamento
--       de receita por (mesmo paciente + mesmo valor + data próxima). Decisão do usuário 06/07;
--       em casos raros pode casar um lançamento parecido — por isso limita a 1 por conversão.
--    c) apaga as conversões desta venda (por ticket_id, ou manuais por proximidade a outcome_at);
--    d) se p_cancel_appointment, cancela a consulta ativa do ticket (tira do Faturamento Real e
--       de Consultas Realizadas, que ancoram em appointment realizado/compareceu);
--    e) desvincula leads.converted_patient_id se NÃO sobrar consulta ativa (lead volta ao
--       pipeline / reengajamento). Com consulta ativa, preserva o vínculo (soltar é inseguro).
-- 3) Reabre o MESMO ticket na etapa-alvo. O trigger trg_enforce_ticket_resolution (BEFORE
--    UPDATE OF stage_id) zera outcome/outcome_at sozinho (stage vira ativo sem tocar outcome).
--    loss_reason é limpo (cancelar perda). Reabrir (closed->open) NÃO religa a IA
--    (fn_activate_ai_on_ticket_resolved só roda em open->closed).
--
-- Observações
-- ----------
-- * NÃO apaga patient nem appointment (têm FKs p/ prontuário/financeiro; deletar é perigoso).
-- * PERDA: reabre e limpa loss_reason; não há receita/consulta envolvida.
-- * A RPC recusa alvo terminal (ganho/perdido): "cancelar" pressupõe etapa ativa.

CREATE OR REPLACE FUNCTION public.reopen_ticket(
  p_ticket_id uuid,
  p_new_stage_id uuid,
  p_cancel_appointment boolean DEFAULT false
) RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead        uuid;
  v_clinic      uuid;
  v_outcome     text;
  v_outcome_at  timestamptz;
  v_status      text;
  v_patient     uuid;
  v_new_slug    text;
  v_tx_ids      uuid[] := '{}';
  v_conv        RECORD;
  v_match       uuid;
BEGIN
  SELECT lead_id, clinic_id, outcome, outcome_at, status
    INTO v_lead, v_clinic, v_outcome, v_outcome_at, v_status
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF v_new_slug IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  -- "Cancelar desfecho" pressupõe mover para etapa ATIVA (não terminal).
  IF v_new_slug IN ('ganho', 'perdido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'target_must_be_active');
  END IF;

  SELECT converted_patient_id INTO v_patient FROM leads WHERE id = v_lead;

  -- (1) Invariante 1-ticket-aberto-por-lead: fecha qualquer OUTRO aberto antes de reabrir este.
  UPDATE tickets
    SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE lead_id = v_lead AND id <> p_ticket_id AND status = 'open';

  -- (2) VENDA: limpa conversão + receita.
  IF v_outcome = 'ganho' THEN
    -- (2a) Receita com vínculo confiável (espelha fn_cascade_delete_ticket_ganho).
    v_tx_ids := ARRAY(
      SELECT c.financial_transaction_id FROM conversions c
      WHERE c.ticket_id = p_ticket_id AND c.financial_transaction_id IS NOT NULL
      UNION
      SELECT ft.id FROM financial_transactions ft
      JOIN appointments a ON a.id = ft.appointment_id
      WHERE a.ticket_id = p_ticket_id AND ft.type = 'receita'
    );

    -- (2b) Melhor-esforço p/ venda manual: 1 lançamento por conversão (paciente+valor+data~).
    IF v_patient IS NOT NULL THEN
      FOR v_conv IN
        SELECT value, converted_at::date AS cdate FROM conversions
        WHERE ticket_id = p_ticket_id
           OR (lead_id = v_lead AND ticket_id IS NULL
               AND (v_outcome_at IS NULL
                    OR created_at BETWEEN v_outcome_at - interval '1 hour' AND v_outcome_at + interval '1 hour'))
      LOOP
        SELECT ft.id INTO v_match
        FROM financial_transactions ft
        WHERE ft.clinic_id = v_clinic AND ft.type = 'receita'
          AND ft.patient_id = v_patient
          AND ft.amount = v_conv.value
          AND ft.date BETWEEN v_conv.cdate - 3 AND v_conv.cdate + 3
          AND NOT (ft.id = ANY(v_tx_ids))
        ORDER BY abs(ft.date - v_conv.cdate)
        LIMIT 1;
        IF v_match IS NOT NULL THEN
          v_tx_ids := array_append(v_tx_ids, v_match);
        END IF;
      END LOOP;
    END IF;

    -- (2c) Apaga as conversões desta venda.
    DELETE FROM conversions
    WHERE ticket_id = p_ticket_id
       OR (lead_id = v_lead AND ticket_id IS NULL
           AND (v_outcome_at IS NULL
                OR created_at BETWEEN v_outcome_at - interval '1 hour' AND v_outcome_at + interval '1 hour'));

    -- (2d) Apaga os lançamentos de receita coletados.
    IF array_length(v_tx_ids, 1) > 0 THEN
      DELETE FROM financial_transactions WHERE id = ANY(v_tx_ids);
    END IF;

    -- (2e) Cancela a consulta ativa junto (opcional).
    IF p_cancel_appointment THEN
      UPDATE appointments SET status = 'cancelado'
      WHERE ticket_id = p_ticket_id AND status NOT IN ('cancelado', 'faltou');
    END IF;

    -- (2f) Desvincula o paciente se não sobrar consulta ativa.
    IF NOT EXISTS (
      SELECT 1 FROM appointments
      WHERE ticket_id = p_ticket_id AND status NOT IN ('cancelado', 'faltou')
    ) THEN
      UPDATE leads SET converted_patient_id = NULL WHERE id = v_lead;
    END IF;
  END IF;

  -- (3) Reabre o MESMO ticket na etapa-alvo (trigger zera outcome/outcome_at).
  UPDATE tickets
    SET stage_id = p_new_stage_id, status = 'open', closed_at = NULL, loss_reason = NULL
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'new_stage_id', p_new_stage_id,
    'reopened', true,
    'cancelled_outcome', v_outcome,
    'removed_transactions', COALESCE(array_length(v_tx_ids, 1), 0)
  );
END;
$function$;
