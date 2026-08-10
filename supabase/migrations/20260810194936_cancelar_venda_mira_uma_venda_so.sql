-- ETAPA 2 de 6 do plano "varias vendas no mesmo card" (decisao do dono, 10/08).
--
-- ⚠️ O QUE ISTO IMPEDE: hoje "Cancelar venda" apaga em BLOCO. `fn_purge_ticket_sale` faz
-- `DELETE FROM conversions WHERE ticket_id = ...` sem filtro, e `reopen_ticket` faz o mesmo. Com uma
-- venda por card isso passa despercebido; com varias, perder a 4a negociacao apagaria as 3 receitas
-- anteriores e os 3 lancamentos financeiros do cliente.
--
-- ⚠️ E TEM UM RISCO QUE JA EXISTE HOJE: quando a conversao nao tem receita ligada, o `reopen_ticket`
-- procura o lancamento por SEMELHANCA (mesmo paciente, mesmo valor, data +/- 3 dias). Isso pode
-- apagar a receita de OUTRO card do mesmo cliente. Medido pela revisao: 12 pares de receitas de
-- cards diferentes ja casam nesse criterio hoje. Agora o casamento nunca rouba um lancamento que
-- pertenca a outra conversao.
--
-- 🔒 E fecha uma brecha: `reopen_ticket` era a UNICA da familia sem conferencia de clinica
-- (`finalize_ticket` e `set_ticket_stage` tem `assert_clinic_access`), sendo SECURITY DEFINER e com
-- EXECUTE para authenticated. Ou seja, apagava receita de outra clinica para quem soubesse o id.
--
-- 📌 Com UMA venda por card (o estado de hoje, garantido pelo indice `conversions_one_per_ticket`
-- ate a etapa 3), o comportamento e IDENTICO ao de antes. A mudanca so aparece quando houver mais
-- de uma, e ai o sistema RECUSA em vez de adivinhar.
--
-- PROVADO em transacao revertida (10/08), com o indice derrubado dentro da transacao para simular
-- o futuro:
--   A) card com 1 venda: success=true, venda apagada, igual a antes;
--   B) card com 2 vendas SEM alvo: success=false, error_code='multiplas_vendas', NADA apagado;
--   C) card com 2 vendas COM alvo: apagou so a escolhida, a original continuou intacta.
--
-- ⚠️ DROP + CREATE em vez de CREATE OR REPLACE: as duas funcoes ganham um parametro novo, e
-- `CREATE OR REPLACE` com lista de argumentos diferente NAO substitui, cria uma SEGUNDA overload
-- (foi exatamente o erro que eu cometi 20 minutos antes, migration 20260810194132). DDL no Postgres
-- e transacional, entao nao existe janela sem a funcao.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Vinculo orcamento -> venda. Fica NULL nos legados e e preenchido a partir da etapa 3
--    (`close_sale_from_orcamento`). Sem ele nao da para reverter o orcamento CERTO quando a venda
--    correspondente e cancelada.
ALTER TABLE public.orcamentos
  ADD COLUMN IF NOT EXISTS conversion_id uuid REFERENCES public.conversions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_orcamentos_conversion
  ON public.orcamentos(conversion_id) WHERE conversion_id IS NOT NULL;

COMMENT ON COLUMN public.orcamentos.conversion_id IS
  'Venda (conversions) gerada por este orcamento. NULL = legado ou ainda nao aprovado. Usada para reverter apenas o orcamento da venda cancelada, nunca todos do card.';

-- Faltava indice por card: a partir da etapa 6 a tela consulta orcamento por card.
CREATE INDEX IF NOT EXISTS ix_orcamentos_ticket
  ON public.orcamentos(ticket_id) WHERE ticket_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) fn_purge_ticket_sale: apaga UMA venda, nao todas.
DROP FUNCTION IF EXISTS public.fn_purge_ticket_sale(uuid);

CREATE FUNCTION public.fn_purge_ticket_sale(p_ticket_id uuid, p_conversion_id uuid DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx_ids uuid[];
  v_ids    uuid[];
  v_total  numeric;
  v_qtd    int;
  v_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_clinic FROM tickets WHERE id = p_ticket_id;

  SELECT count(*) INTO v_qtd FROM conversions WHERE ticket_id = p_ticket_id;

  -- ⚠️ Mais de uma venda e nenhum alvo: NAO adivinha. Recusar e barulhento, apagar e silencioso,
  -- e dinheiro apagado em silencio e o pior desfecho possivel aqui.
  IF v_qtd > 1 AND p_conversion_id IS NULL THEN
    PERFORM log_system_error(
      'venda', 'cancelamento_ambiguo',
      'Cancelamento de venda recusado: o card tem mais de uma venda lançada',
      'warn', v_clinic,
      jsonb_build_object('ticket_id', p_ticket_id, 'vendas', v_qtd), false);
    RAISE EXCEPTION 'Este card tem % vendas lançadas. Cancele a venda específica em vez do card inteiro.', v_qtd
      USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(c.id), coalesce(sum(c.value), 0)
    INTO v_ids, v_total
  FROM conversions c
  WHERE c.ticket_id = p_ticket_id
    AND (p_conversion_id IS NULL OR c.id = p_conversion_id);

  IF v_ids IS NULL THEN RETURN; END IF;

  -- Marca a transacao para o gatilho do orcamento reverter so o que corresponde a esta venda.
  PERFORM set_config('app.cancel_conversion_ids', array_to_string(v_ids, ','), true);

  SELECT array_agg(c.financial_transaction_id) INTO v_tx_ids
  FROM conversions c
  WHERE c.id = ANY(v_ids) AND c.financial_transaction_id IS NOT NULL;

  DELETE FROM conversions WHERE id = ANY(v_ids);

  IF v_tx_ids IS NOT NULL AND array_length(v_tx_ids, 1) > 0 THEN
    DELETE FROM financial_transactions WHERE id = ANY(v_tx_ids);
  END IF;

  -- 📌 §0.5: receita apagada e o unico registro de que ela existiu. Sempre acende, mesmo no sucesso.
  PERFORM log_system_error(
    'venda', 'venda_apagada',
    'Venda cancelada: receita e lançamento financeiro removidos',
    'info', v_clinic,
    jsonb_build_object('ticket_id', p_ticket_id, 'vendas_apagadas', array_length(v_ids, 1),
                       'valor_total', v_total, 'alvo', p_conversion_id), false);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_purge_ticket_sale(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_ticket_sale(uuid, uuid) TO service_role;

-- Higiene: gatilho nao precisa de EXECUTE para o cliente logado.
REVOKE ALL ON FUNCTION public.fn_ticket_left_ganho() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) fn_orcamento_revert_on_sale_lost: reverte o orcamento DA VENDA cancelada, nao todos.
CREATE OR REPLACE FUNCTION public.fn_orcamento_revert_on_sale_lost()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_marca text := coalesce(current_setting('app.cancel_conversion_ids', true), '');
  v_ids   uuid[];
  v_aprov int;
BEGIN
  IF NOT (OLD.outcome = 'ganho' AND NEW.outcome IS DISTINCT FROM 'ganho') THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_aprov
  FROM public.orcamentos WHERE approved_ticket_id = OLD.id AND status = 'aprovado';

  -- Alvo explicito SO vale quando ha mais de um orcamento aprovado no card. Com um so, nao existe
  -- ambiguidade e o caminho antigo (em bloco) e o certo, inclusive para os legados sem vinculo.
  IF v_aprov > 1 AND v_marca <> '' THEN
    SELECT array_agg(x::uuid) INTO v_ids FROM unnest(string_to_array(v_marca, ',')) x;

    UPDATE public.stock_reservations SET status = 'liberada', released_at = now()
    WHERE status = 'ativa'
      AND orcamento_id IN (SELECT id FROM public.orcamentos
                            WHERE approved_ticket_id = OLD.id AND status = 'aprovado'
                              AND conversion_id = ANY(v_ids));

    UPDATE public.orcamentos SET status = 'enviado', approved_ticket_id = NULL, conversion_id = NULL
    WHERE approved_ticket_id = OLD.id AND status = 'aprovado' AND conversion_id = ANY(v_ids);

    RETURN NEW;
  END IF;

  UPDATE public.stock_reservations SET status = 'liberada', released_at = now()
  WHERE status = 'ativa'
    AND orcamento_id IN (SELECT id FROM public.orcamentos WHERE approved_ticket_id = OLD.id AND status = 'aprovado');
  UPDATE public.orcamentos SET status = 'enviado', approved_ticket_id = NULL, conversion_id = NULL
  WHERE approved_ticket_id = OLD.id AND status = 'aprovado';

  RETURN NEW;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) reopen_ticket: guard de clinica, alvo unico e casamento que nao rouba receita alheia.
DROP FUNCTION IF EXISTS public.reopen_ticket(uuid, uuid, boolean);

CREATE FUNCTION public.reopen_ticket(p_ticket_id uuid, p_new_stage_id uuid, p_cancel_appointment boolean DEFAULT false, p_conversion_id uuid DEFAULT NULL)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) fn_cascade_delete_ticket_ganho: excluir o card continua apagando TUDO (e o que "excluir"
--    significa), mas agora deixa rastro do quanto foi apagado.
CREATE OR REPLACE FUNCTION public.fn_cascade_delete_ticket_ganho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx_ids uuid[];
  v_total  numeric;
  v_qtd    int;
BEGIN
  IF OLD.outcome <> 'ganho' THEN
    RETURN OLD;
  END IF;

  SELECT count(*), coalesce(sum(value), 0) INTO v_qtd, v_total
  FROM conversions WHERE ticket_id = OLD.id;

  SELECT array_agg(c.financial_transaction_id) INTO v_tx_ids
  FROM conversions c
  WHERE c.ticket_id = OLD.id AND c.financial_transaction_id IS NOT NULL;

  SELECT array_cat(v_tx_ids, array_agg(ft.id)) INTO v_tx_ids
  FROM financial_transactions ft
  JOIN appointments a ON a.id = ft.appointment_id
  WHERE a.ticket_id = OLD.id AND ft.type = 'receita';

  DELETE FROM conversions WHERE ticket_id = OLD.id;

  IF v_tx_ids IS NOT NULL AND array_length(v_tx_ids, 1) > 0 THEN
    DELETE FROM financial_transactions WHERE id = ANY(v_tx_ids);
  END IF;

  IF v_qtd > 0 THEN
    PERFORM log_system_error(
      'venda', 'card_excluido_com_venda',
      'Card excluído junto com a venda: receita e lançamento financeiro removidos',
      'warn', OLD.clinic_id,
      jsonb_build_object('ticket_id', OLD.id, 'vendas_apagadas', v_qtd, 'valor_total', v_total), false);
  END IF;

  RETURN OLD;
END;
$function$;
