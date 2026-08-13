-- ════════════════════════════════════════════════════════════════════════════════════════════
-- DESCONTO DE FECHAMENTO: a venda sai pelo valor NEGOCIADO, não necessariamente pelo cotado.
--
-- Antes, fechar por um valor diferente do orçamento só era possível pela venda avulsa do Kanban,
-- e aí a proposta ficava viva em "Enviado", sem virar pedido, produção nem recibo. Na Central de
-- Orçamentos não havia saída nenhuma: ou fechava pelo valor cheio, ou não fechava.
--
-- `p_total` já existia (é como a aprovação parcial de itens funciona) e já manda no valor da venda,
-- na receita do Financeiro e no total do orçamento. O que faltava era gravar de onde veio a
-- diferença: sem `subtotal` e `desconto`, o recibo imprime itens que somam 11.286 embaixo de um
-- TOTAL de 10.500, e o documento não fecha a conta na frente do cliente.
--
-- ⚠️ DROP antes do CREATE de propósito. `create or replace` com dois argumentos a mais cria uma
-- SOBRECARGA, não substitui: as duas assinaturas ficariam de pé e a chamada de hoje (10 argumentos
-- nomeados) casaria nas duas, virando "function is not unique" na hora de fechar venda.
-- ════════════════════════════════════════════════════════════════════════════════════════════

drop function if exists public.close_sale_from_orcamento(uuid,text,text,date,text,date,text[],numeric,uuid,boolean);

CREATE OR REPLACE FUNCTION public.close_sale_from_orcamento(
  p_orcamento_id uuid,
  p_payment_method text DEFAULT 'pix'::text,
  p_payment_status text DEFAULT 'pago'::text,
  p_payment_date date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date,
  p_category text DEFAULT 'Venda de produto'::text,
  p_data_entrega date DEFAULT NULL::date,
  p_line_keys text[] DEFAULT NULL::text[],
  p_total numeric DEFAULT NULL::numeric,
  p_link_conversion_id uuid DEFAULT NULL::uuid,
  p_link_sync_value boolean DEFAULT false,
  -- Valor CHEIO do que está sendo vendido (soma dos itens que vão para o recibo) e o desconto dado
  -- no fechamento. Os dois andam juntos: é o par que faz o documento fechar a conta.
  p_subtotal numeric DEFAULT NULL::numeric,
  p_desconto numeric DEFAULT NULL::numeric
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

  -- ⚠️ Desconto negativo seria acréscimo escondido num campo que o recibo imprime com sinal de
  -- menos: o cliente assinaria um documento que diz o contrário do que foi cobrado.
  IF p_desconto IS NOT NULL AND p_desconto < 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'desconto_invalido');
  END IF;
  -- O trio tem que fechar (cotado - desconto = total). Quem monta os três números é a tela, então
  -- isto nunca dispara pelo uso normal: é a trava para o próximo chamador, porque um trio que não
  -- fecha vira recibo com conta errada na mão do cliente, e ninguém confere depois.
  IF p_subtotal IS NOT NULL AND abs(p_subtotal - COALESCE(p_desconto, 0) - v_total) > 0.005 THEN
    PERFORM log_system_error('orcamento', 'valores_incoerentes',
      'Fechamento recusado: cotado menos desconto não bate com o total', 'error', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'subtotal', p_subtotal,
                         'desconto', p_desconto, 'total', v_total), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'valores_incoerentes');
  END IF;

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
      total = CASE WHEN p_link_sync_value THEN v_total ELSE total END,
      -- Cotado e desconto seguem o total: gravar a decomposicao de um valor que NAO foi adotado
      -- faria o recibo imprimir um desconto que a venda amarrada nunca teve.
      subtotal = CASE WHEN p_link_sync_value THEN COALESCE(p_subtotal, subtotal) ELSE subtotal END,
      desconto = CASE WHEN p_link_sync_value THEN COALESCE(p_desconto, desconto) ELSE desconto END
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

    IF p_link_sync_value AND COALESCE(p_desconto, 0) > 0 THEN
      PERFORM log_system_error('orcamento', 'venda_com_desconto_de_fechamento',
        'Venda fechada abaixo do valor cotado (desconto dado no fechamento)', 'info', v_orc.clinic_id,
        jsonb_build_object('orcamento_id', p_orcamento_id, 'numero', v_orc.number,
                           'ticket_id', v_ticket.id, 'conversion_id', p_link_conversion_id,
                           'cotado', p_subtotal, 'desconto', p_desconto, 'fechado', v_total,
                           'vinculado', true), false);
    END IF;

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
    total = v_total,
    -- ⚠️ O cotado fica em `subtotal`, e e o que impede o valor original de sumir: `total` passa a
    -- ser o fechado, entao sem isto ninguem mais sabe por quanto a proposta tinha sido oferecida.
    subtotal = COALESCE(p_subtotal, subtotal),
    desconto = COALESCE(p_desconto, desconto)
  WHERE id = p_orcamento_id;

  IF COALESCE(p_desconto, 0) > 0 THEN
    -- 📌 §0.5: desconto no fechamento e intervencao manual em dinheiro. Sem registro, ninguem
    -- descobre depois quanto de margem saiu na hora de fechar, nem em quais vendas.
    PERFORM log_system_error('orcamento', 'venda_com_desconto_de_fechamento',
      'Venda fechada abaixo do valor cotado (desconto dado no fechamento)', 'info', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'numero', v_orc.number,
                         'ticket_id', v_ticket.id, 'conversion_id', v_conv_id,
                         'cotado', p_subtotal, 'desconto', p_desconto, 'fechado', v_total,
                         'vinculado', false), false);
  END IF;

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

-- ⚠️ O DROP levou os grants junto. Refazer pelos DOIS caminhos (§1): `create function` concede
-- EXECUTE a PUBLIC sozinho, e revogar so de `anon` nao fecha nada.
revoke all on function public.close_sale_from_orcamento(uuid,text,text,date,text,date,text[],numeric,uuid,boolean,numeric,numeric) from public, anon, authenticated;
grant execute on function public.close_sale_from_orcamento(uuid,text,text,date,text,date,text[],numeric,uuid,boolean,numeric,numeric) to authenticated, service_role;
