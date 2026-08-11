-- VINCULAR: marcar um orcamento como ganho SEM lancar dinheiro novo, quando a venda daquele card
-- ja foi registrada a mao pelo Kanban.
--
-- ⚠️ O PROBLEMA REAL, medido em 11/08: existem hoje 4 orcamentos em "Enviado", somando R$ 11.341,03,
-- presos a cards que JA foram para Ganho e continuam abertos. Como `close_sale_from_orcamento` nao
-- olha o `outcome` do card (e isso e de proposito desde 10/08, para permitir N vendas por card),
-- clicar em "Marcar Ganho" em qualquer um deles lanca uma SEGUNDA venda por cima de uma que ja
-- existe. Caso concreto: a cliente mychelle leal tem R$ 750 lancados a mao e o orcamento #9 de
-- R$ 1.638 entraria por cima, virando R$ 2.388 num negocio so.
--
-- 📌 A saida NAO e barrar card ganho: um card pode legitimamente ter varias vendas (o cliente PEDRO
-- tem duas, de projetos diferentes). O que faltava era o sistema saber PERGUNTAR: esta proposta e a
-- MESMA venda que ja esta lancada, ou e outra?
--   - outra venda  -> `p_link_conversion_id` nulo, caminho de sempre, lanca tudo;
--   - mesma venda  -> `p_link_conversion_id` preenchido, e entao NAO nasce receita nem conversao:
--     o orcamento so se AMARRA na venda existente e vai para a producao.
--
-- 📌 `p_link_sync_value` resolve o desencontro de valor: quando a venda foi digitada a mao (R$ 750)
-- e a proposta diz outra coisa (R$ 1.638), quem decide qual e a verdade e o dono, na tela. Falso
-- mantem o que ja estava lancado; verdadeiro traz o valor da proposta para a venda e para o
-- financeiro. Reconciliar sozinho seria inventar faturamento nos dois sentidos.
--
-- ⚠️ Este e o mesmo botao que regulariza o backlog dos 75 orcamentos parados em "Enviado" cujo card
-- ja foi ganho: um a um, sem criar dinheiro.
--
-- ⚠️ DROP antes do CREATE: a assinatura ganha dois parametros, e `CREATE OR REPLACE` com lista
-- diferente criaria uma SEGUNDA sobrecarga em vez de substituir (foi assim que o `finalize_ticket`
-- ficou ambiguo por 2 minutos em 10/08 e uma venda de CRM se perdeu). DDL e transacional: nao ha
-- janela sem a funcao.
--
-- PROVADO em transacao revertida (11/08):
--   vincular o #9 a venda de R$ 750 da mychelle -> orcamento vira 'aprovado', producao provisionada
--     com 2 ordens, e o card continua com UMA venda de R$ 750 (nao dobrou);
--   2a proposta tentando a mesma venda            -> venda_ja_vinculada;
--   proposta apontando venda de outro card        -> venda_de_outro_card;
--   caminho normal (sem vincular) no card do PEDRO -> 3a venda legitima, sem regressao.

DROP FUNCTION IF EXISTS public.close_sale_from_orcamento(uuid, text, text, date, text, date, text[], numeric);

CREATE FUNCTION public.close_sale_from_orcamento(
  p_orcamento_id uuid,
  p_payment_method text DEFAULT 'pix'::text,
  p_payment_status text DEFAULT 'pago'::text,
  p_payment_date date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date,
  p_category text DEFAULT 'Venda de produto'::text,
  p_data_entrega date DEFAULT NULL::date,
  p_line_keys text[] DEFAULT NULL::text[],
  p_total numeric DEFAULT NULL::numeric,
  p_link_conversion_id uuid DEFAULT NULL::uuid,
  p_link_sync_value boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc      public.orcamentos%ROWTYPE;
  v_ticket   RECORD;
  v_lead     RECORD;
  v_patient  uuid;
  v_tx_id    uuid;
  v_conv_id  uuid;
  v_finalize jsonb;
  v_prov     jsonb;
  v_total    numeric;
  v_link     RECORD;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_not_found'); END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;

  -- 📌 §0.5: toda recusa acende na Central.
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    PERFORM log_system_error('orcamento', 'aprovacao_recusada',
      'Aprovação de orçamento recusada: já processado', 'warn', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'status', v_orc.status), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;
  IF v_orc.validade IS NOT NULL AND v_orc.validade < (now() at time zone 'America/Sao_Paulo')::date THEN
    PERFORM log_system_error('orcamento', 'aprovacao_recusada',
      'Aprovação de orçamento recusada: orçamento vencido', 'warn', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'validade', v_orc.validade), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_vencido', 'validade', v_orc.validade);
  END IF;
  IF v_orc.lead_id IS NULL THEN
    PERFORM log_system_error('orcamento', 'aprovacao_recusada',
      'Aprovação de orçamento recusada: orçamento sem cliente vinculado', 'error', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'no_lead_linked');
  END IF;
  IF p_line_keys IS NOT NULL AND array_length(p_line_keys, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'nenhum_item_selecionado');
  END IF;

  v_total := COALESCE(p_total, v_orc.total);

  SELECT id, outcome, status INTO v_ticket
  FROM public.tickets WHERE lead_id = v_orc.lead_id AND status = 'open' FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    PERFORM log_system_error('orcamento', 'aprovacao_sem_card_aberto',
      'Aprovação de orçamento recusada: o cliente não tem card aberto (abra um card novo)',
      'warn', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'lead_id', v_orc.lead_id), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'no_open_ticket');
  END IF;
  IF v_ticket.outcome = 'perdido' THEN
    PERFORM log_system_error('orcamento', 'aprovacao_recusada',
      'Aprovação de orçamento recusada: o card está marcado como perdido', 'warn', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'ticket_id', v_ticket.id), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_perdido');
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CAMINHO A: VINCULAR a uma venda que ja existe. Nao nasce dinheiro aqui.
  -- ═══════════════════════════════════════════════════════════════════════════
  IF p_link_conversion_id IS NOT NULL THEN
    SELECT c.id, c.value, c.ticket_id, c.clinic_id, c.financial_transaction_id
      INTO v_link
    FROM public.conversions c WHERE c.id = p_link_conversion_id FOR UPDATE;

    IF NOT FOUND OR v_link.clinic_id <> v_orc.clinic_id THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'venda_nao_encontrada');
    END IF;
    -- A venda tem que ser DESTE card: vincular a proposta de um cliente na venda de outro
    -- embaralharia faturamento e producao de dois negocios.
    IF v_link.ticket_id IS DISTINCT FROM v_ticket.id THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'venda_de_outro_card');
    END IF;
    -- Uma venda pertence a UMA proposta: sem isto, duas propostas se diriam donas do mesmo dinheiro
    -- e o cancelamento de venda nao saberia o que reverter.
    IF EXISTS (SELECT 1 FROM public.orcamentos o
                WHERE o.conversion_id = p_link_conversion_id AND o.id <> p_orcamento_id) THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'venda_ja_vinculada');
    END IF;

    IF p_link_sync_value AND v_total IS DISTINCT FROM v_link.value THEN
      UPDATE public.conversions SET value = v_total WHERE id = p_link_conversion_id;
      IF v_link.financial_transaction_id IS NOT NULL THEN
        UPDATE public.financial_transactions SET amount = v_total WHERE id = v_link.financial_transaction_id;
      END IF;
    END IF;

    UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
      conversion_id = p_link_conversion_id,
      data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista),
      approved_line_keys = COALESCE(p_line_keys, approved_line_keys),
      -- ⚠️ Sem `p_link_sync_value`, o total da PROPOSTA nao vira o valor da venda nem o contrario:
      -- os dois numeros ficam como estao, e a divergencia continua visivel em vez de sumir.
      total = CASE WHEN p_link_sync_value THEN v_total ELSE total END
    WHERE id = p_orcamento_id;

    v_prov := public.provision_orcamento(p_orcamento_id);
    IF NOT COALESCE((v_prov->>'success')::boolean, true) THEN
      PERFORM log_system_error('orcamento', 'provisionamento_falhou',
        'Proposta vinculada à venda, mas a produção/estoque não foi provisionada', 'error', v_orc.clinic_id,
        jsonb_build_object('orcamento_id', p_orcamento_id, 'ticket_id', v_ticket.id,
                           'erro', v_prov->>'error_code'), false);
    END IF;

    -- 📌 Vincular e intervencao manual em dado de faturamento: fica registrado.
    PERFORM log_system_error('orcamento', 'proposta_vinculada_a_venda',
      'Proposta marcada como ganha e amarrada a uma venda que já existia (sem lançar dinheiro novo)',
      'info', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'numero', v_orc.number,
                         'ticket_id', v_ticket.id, 'conversion_id', p_link_conversion_id,
                         'valor_da_venda', v_link.value, 'valor_da_proposta', v_total,
                         'valor_sincronizado', p_link_sync_value), false);

    RETURN jsonb_build_object('success', true, 'vinculado', true, 'ticket_id', v_ticket.id,
      'conversion_id', p_link_conversion_id, 'financial_transaction_id', v_link.financial_transaction_id,
      'total', CASE WHEN p_link_sync_value THEN v_total ELSE v_link.value END,
      'provisionamento', v_prov);
  END IF;

  -- ═══════════════════════════════════════════════════════════════════════════
  -- CAMINHO B: venda NOVA (o de sempre).
  -- ⚠️ Card ja ganho segue o MESMO caminho: lanca receita, cria a venda com data propria e manda
  -- para a producao. `finalize_ticket` preserva a data da venda anterior.
  -- ═══════════════════════════════════════════════════════════════════════════
  SELECT converted_patient_id, name, phone INTO v_lead FROM public.leads WHERE id = v_orc.lead_id;
  v_patient := v_lead.converted_patient_id;
  IF v_patient IS NULL THEN
    IF v_lead.phone IS NOT NULL THEN
      SELECT id INTO v_patient FROM public.patients
      WHERE clinic_id = v_orc.clinic_id AND phone IS NOT NULL AND normalize_br_phone(phone) = normalize_br_phone(v_lead.phone) LIMIT 1;
    END IF;
    IF v_patient IS NULL THEN
      INSERT INTO public.patients (clinic_id, name, phone) VALUES (v_orc.clinic_id, v_lead.name, v_lead.phone) RETURNING id INTO v_patient;
    END IF;
    UPDATE public.leads SET converted_patient_id = v_patient WHERE id = v_orc.lead_id AND converted_patient_id IS NULL;
  END IF;

  INSERT INTO public.financial_transactions (clinic_id, patient_id, type, category, amount, description, payment_method, status, date)
  VALUES (v_orc.clinic_id, v_patient, 'receita', p_category, v_total, 'Orçamento #' || v_orc.number, p_payment_method, p_payment_status, p_payment_date)
  RETURNING id INTO v_tx_id;

  -- Cada venda com a SUA data: e o que faz o faturamento por periodo bater.
  INSERT INTO public.conversions (clinic_id, lead_id, ticket_id, value, description, payment_method, converted_at, financial_transaction_id)
  VALUES (v_orc.clinic_id, v_orc.lead_id, v_ticket.id, v_total, 'Orçamento #' || v_orc.number, p_payment_method, (p_payment_date::timestamp + interval '12 hour'), v_tx_id)
  RETURNING id INTO v_conv_id;

  SELECT public.finalize_ticket(v_ticket.id, 'ganho', NULL, NULL, false) INTO v_finalize;
  IF NOT COALESCE((v_finalize->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'finalize_ticket falhou ao aprovar orçamento %: %', p_orcamento_id, v_finalize->>'error_code';
  END IF;

  -- `conversion_id` e o que permite cancelar UMA venda e reverter SO o orcamento dela.
  UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
    conversion_id = v_conv_id,
    data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista),
    approved_line_keys = COALESCE(p_line_keys, approved_line_keys),
    total = v_total
  WHERE id = p_orcamento_id;

  v_prov := public.provision_orcamento(p_orcamento_id);
  IF NOT COALESCE((v_prov->>'success')::boolean, true) THEN
    PERFORM log_system_error('orcamento', 'provisionamento_falhou',
      'Venda lançada, mas a produção/estoque não foi provisionada', 'error', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'ticket_id', v_ticket.id,
                         'erro', v_prov->>'error_code'), false);
  END IF;

  RETURN jsonb_build_object('success', true, 'vinculado', false, 'ticket_id', v_ticket.id,
    'financial_transaction_id', v_tx_id, 'conversion_id', v_conv_id, 'patient_id', v_patient,
    'total', v_total, 'provisionamento', v_prov);
END;
$function$;

REVOKE ALL ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text, date, text[], numeric, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text, date, text[], numeric, uuid, boolean) TO authenticated, service_role;
