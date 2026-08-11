-- Cancelar UMA venda de um card que tem VARIAS nao pode desfazer o card inteiro.
--
-- ⚠️ O DEFEITO: o `UPDATE` final desta funcao zerava `outcome` e `outcome_at` e movia a etapa
-- SEMPRE, sem olhar se ainda sobrava venda no card. Como `v_kpi_wins` exige `outcome='ganho'` e
-- `v_kpi_sales_value` le `conversions` sem olhar o ticket, cancelar uma venda de um card com duas
-- deixaria o card FORA da contagem de vendas com o dinheiro da outra ainda no faturamento. Seria o
-- primeiro caso da base a quebrar a invariante "conversao so existe em card ganho" (medido em
-- 11/08: 133 cards com venda, 100% em outcome='ganho').
--
-- 📌 Ate agora isso era INALCANCAVEL, e por isso nunca aconteceu: o front nao mandava
-- `p_conversion_id`, entao card com mais de uma venda batia em `multiplas_vendas` e nada acontecia.
-- A janela unica de venda passou a mandar o alvo, e foi ela que tornou o caminho alcancavel.
--
-- 📌 A REGRA NOVA: sobrou venda no card, ele CONTINUA ganho. A funcao apaga so a venda escolhida
-- (e a receita dela) e devolve `reopened=false`. Nao mexe em etapa, nem em desfecho, nem desvincula
-- paciente. `outcome_at` se ajusta sozinho pelo gatilho `zz_trg_conversions_sync_outcome_at`, que
-- reaponta o card para a venda mais antiga que restou.
--
-- ⚠️ O desvinculo do paciente tambem entrou na guarda: com venda viva no card, o cliente continua
-- sendo cliente.
--
-- PROVADO em transacao revertida (11/08), no card do PEDRO (2 vendas: R$2.772 em 06/08 e R$1.500
-- em 07/08):
--   cancelar so a de 1.500 -> reopened=false, restam 1 venda de R$2.772, card SEGUE 'ganho' em 06/08;
--   cancelar a ultima      -> reopened=true, 0 vendas, card com outcome NULO.

CREATE OR REPLACE FUNCTION public.reopen_ticket(p_ticket_id uuid, p_new_stage_id uuid, p_cancel_appointment boolean DEFAULT false, p_conversion_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead    uuid;
  v_clinic  uuid;
  v_outcome text;
  v_outcome_at timestamptz;
  v_status  text;
  v_patient uuid;
  v_new_slug text;
  v_tx_ids  uuid[] := '{}';
  v_conv    RECORD;
  v_match   uuid;
  v_ids     uuid[];
  v_qtd     int;
  v_total   numeric := 0;
  v_restam  int := 0;
BEGIN
  PERFORM set_config('app.stage_source', 'kanban_reopen', true);
  PERFORM set_config('app.stage_actor', COALESCE(auth.uid()::text, ''), true);

  SELECT lead_id, clinic_id, outcome, outcome_at, status
    INTO v_lead, v_clinic, v_outcome, v_outcome_at, v_status
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  -- 🔒 Guard de tenant, que faltava aqui e existe nas irmas. Esta funcao APAGA receita: sem isto,
  -- qualquer usuario logado apagava a venda de outra clinica sabendo o id do card.
  PERFORM public.assert_clinic_access(v_clinic);

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  IF v_new_slug IN ('ganho', 'perdido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'target_must_be_active');
  END IF;

  SELECT converted_patient_id INTO v_patient FROM leads WHERE id = v_lead;

  UPDATE tickets
    SET status = 'closed', closed_at = COALESCE(closed_at, now())
    WHERE lead_id = v_lead AND id <> p_ticket_id AND status = 'open';

  IF v_outcome = 'ganho' THEN
    SELECT count(*) INTO v_qtd FROM conversions WHERE ticket_id = p_ticket_id;

    -- ⚠️ Mais de uma venda e nenhum alvo: devolve a lista para a tela perguntar qual cancelar.
    -- Nunca apaga por conta propria.
    IF v_qtd > 1 AND p_conversion_id IS NULL THEN
      PERFORM log_system_error(
        'venda', 'cancelamento_ambiguo',
        'Cancelamento de venda recusado: o card tem mais de uma venda lançada',
        'warn', v_clinic,
        jsonb_build_object('ticket_id', p_ticket_id, 'vendas', v_qtd), false);
      RETURN jsonb_build_object(
        'success', false, 'error_code', 'multiplas_vendas', 'vendas', v_qtd,
        'lista', (SELECT jsonb_agg(jsonb_build_object(
                    'conversion_id', c.id, 'valor', c.value,
                    'data', c.converted_at, 'descricao', c.description) ORDER BY c.converted_at)
                  FROM conversions c WHERE c.ticket_id = p_ticket_id));
    END IF;

    -- Alvo: a venda escolhida, ou a unica do card.
    SELECT array_agg(c.id), coalesce(sum(c.value), 0) INTO v_ids, v_total
    FROM conversions c
    WHERE c.ticket_id = p_ticket_id
      AND (p_conversion_id IS NULL OR c.id = p_conversion_id);

    IF p_conversion_id IS NOT NULL AND v_ids IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'venda_nao_encontrada');
    END IF;

    -- Conversao ORFA (legado sem card) so entra quando se cancela o card inteiro, nunca quando se
    -- mira uma venda especifica.
    IF p_conversion_id IS NULL THEN
      v_ids := COALESCE(v_ids, '{}') || COALESCE(ARRAY(
        SELECT c.id FROM conversions c
         WHERE c.lead_id = v_lead AND c.ticket_id IS NULL
           AND (v_outcome_at IS NULL
                OR c.created_at BETWEEN v_outcome_at - interval '1 hour' AND v_outcome_at + interval '1 hour')
      ), '{}');
    END IF;

    PERFORM set_config('app.cancel_conversion_ids', array_to_string(COALESCE(v_ids,'{}'), ','), true);

    -- Receita ligada de forma explicita: e a fonte confiavel.
    v_tx_ids := ARRAY(
      SELECT c.financial_transaction_id FROM conversions c
      WHERE c.id = ANY(v_ids) AND c.financial_transaction_id IS NOT NULL
      UNION
      SELECT ft.id FROM financial_transactions ft
      JOIN appointments a ON a.id = ft.appointment_id
      WHERE a.ticket_id = p_ticket_id AND ft.type = 'receita'
    );

    -- Casamento por semelhanca: SO para conversao legada sem receita ligada, e nunca pegando um
    -- lancamento que ja pertence a outra conversao (era por aqui que a receita de outro card sumia).
    IF v_patient IS NOT NULL THEN
      FOR v_conv IN
        SELECT c.value, c.converted_at::date AS cdate FROM conversions c
        WHERE c.id = ANY(v_ids) AND c.financial_transaction_id IS NULL
      LOOP
        SELECT ft.id INTO v_match
        FROM financial_transactions ft
        WHERE ft.clinic_id = v_clinic AND ft.type = 'receita'
          AND ft.patient_id = v_patient
          AND ft.amount = v_conv.value
          AND ft.date BETWEEN v_conv.cdate - 3 AND v_conv.cdate + 3
          AND NOT (ft.id = ANY(v_tx_ids))
          AND NOT EXISTS (SELECT 1 FROM conversions c2
                           WHERE c2.financial_transaction_id = ft.id
                             AND NOT (c2.id = ANY(v_ids)))
        ORDER BY abs(ft.date - v_conv.cdate)
        LIMIT 1;
        IF v_match IS NOT NULL THEN
          v_tx_ids := array_append(v_tx_ids, v_match);
        END IF;
      END LOOP;
    END IF;

    DELETE FROM conversions WHERE id = ANY(v_ids);

    IF array_length(v_tx_ids, 1) > 0 THEN
      DELETE FROM financial_transactions WHERE id = ANY(v_tx_ids);
    END IF;

    PERFORM log_system_error(
      'venda', 'venda_apagada',
      'Venda cancelada pelo Kanban: receita e lançamento financeiro removidos',
      'info', v_clinic,
      jsonb_build_object('ticket_id', p_ticket_id, 'vendas_apagadas', COALESCE(array_length(v_ids,1),0),
                         'valor_total', v_total, 'lancamentos', COALESCE(array_length(v_tx_ids,1),0),
                         'alvo', p_conversion_id), false);

    -- ⚠️ AQUI ESTA A REGRA NOVA: sobrou venda, o card CONTINUA ganho.
    -- Sem isto, cancelar uma venda de duas tirava o card da contagem e deixava o dinheiro da outra
    -- solto no faturamento. Nao mexe em etapa, nem em desfecho, nem desvincula o paciente:
    -- `outcome_at` se reaponta sozinho pelo gatilho de `conversions`.
    SELECT count(*) INTO v_restam FROM conversions WHERE ticket_id = p_ticket_id;
    IF v_restam > 0 THEN
      RETURN jsonb_build_object(
        'success', true, 'ticket_id', p_ticket_id, 'reopened', false,
        'venda_removida', true, 'vendas_restantes', v_restam,
        'removed_transactions', COALESCE(array_length(v_tx_ids, 1), 0));
    END IF;

    IF p_cancel_appointment THEN
      UPDATE appointments SET status = 'cancelado'
      WHERE ticket_id = p_ticket_id AND status NOT IN ('cancelado', 'faltou');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM appointments
      WHERE ticket_id = p_ticket_id AND status NOT IN ('cancelado', 'faltou')
    ) THEN
      UPDATE leads SET converted_patient_id = NULL WHERE id = v_lead;
    END IF;
  END IF;

  UPDATE tickets
    SET stage_id         = p_new_stage_id,
        status           = 'open',
        closed_at        = NULL,
        loss_reason      = NULL,
        loss_reason_slug = NULL,
        loss_note        = NULL,
        outcome          = NULL,
        outcome_at       = NULL
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

REVOKE ALL ON FUNCTION public.reopen_ticket(uuid, uuid, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_ticket(uuid, uuid, boolean, uuid) TO authenticated, service_role;
