-- Edicao de orcamento GANHO (status gravado 'aprovado'), a pedido do dono em 11/08, depois de
-- avisado do risco e reafirmando.
--
-- ⚠️ ARQUEOLOGIA: o corpo de `save_orcamento` desta migration foi SUBSTITUIDO 4 minutos depois por
-- `20260811191503_reprovisionar_so_quando_a_fabrica_muda.sql`. O que mudou la: aqui o gatilho do
-- reprovisionamento era "o array `lines` mudou", e isso se mostrou grosseiro demais, porque a linha
-- guarda `price`, `discount` e `fee` no MESMO objeto que `qty` e `altura`. Na pratica, dar um
-- desconto (a edicao mais comum) cancelava a ordem de producao e emitia outra com numero novo para
-- o mesmo servico. Leia a migration seguinte para o estado atual; esta fica pelo racional abaixo,
-- que continua valendo inteiro.
--
-- 📌 POR QUE ISSO NAO E SO "LIBERAR O BOTAO": quando o orcamento e ganho, ele ja gerou QUATRO
-- coisas, e todas nasceram do mesmo snapshot:
--   1. a venda            (`conversions`)
--   2. a receita          (`financial_transactions`)
--   3. a reserva de estoque (`stock_reservations`)
--   4. a ordem de producao  (`production_orders`)
-- As duas ultimas saem de `provision_orcamento`, que roda UMA vez, na aprovacao. Uma tentativa
-- anterior (revertida em 20260811180442) sincronizava so o dinheiro: trocar os itens deixava o
-- estoque reservado com o material ANTIGO, e a entrega baixaria a mercadoria errada, em silencio.
--
-- ⚠️ A REGRA: o que a edicao mexer, ela refaz.
--   - mexeu no VALOR  -> a venda e a receita acompanham;
--   - mexeu nas LINHAS -> a reserva e a producao sao REFEITAS (libera, cancela o que estava
--     planejado e reprovisiona do zero, porque `provision_orcamento` NAO e idempotente).
--
-- ⚠️ Cancelar ANTES de reprovisionar nao e detalhe de estilo: o indice
-- `production_orders_orcamento_line_uidx` e UNICO por (orcamento_id, orcamento_line_key) e so
-- ignora quem esta 'cancelada'. Chamar `provision_orcamento` sem cancelar antes devolve 23505 e
-- derruba a gravacao inteira. (Confirmado no banco vivo em 11/08.)
--
-- ⚠️ TRES PORTAS FECHADAS, cada uma com motivo fisico, nao burocratico:
--   - `ja_entregue`: a mercadoria saiu e o estoque ja baixou (`inventory_movements`). Reescrever o
--     documento agora nao traz o material de volta.
--   - `producao_iniciada`: ha ordem em producao ou concluida. O material ja foi consumido no chao
--     de fabrica; cancelar a ordem por tela nao desfaz o corte. (Hoje: 0 casos.)
--   - `aprovacao_parcial`: o orcamento foi ganho so com ALGUNS itens (`approved_line_keys` guarda
--     'L1','L2'... pela POSICAO da linha). Reordenar ou remover linha faria as chaves apontarem
--     para o item errado, e o pedido mudaria sozinho. (Hoje: 1 orcamento nesta condicao.)
-- Nos tres casos o caminho continua sendo cancelar a venda no Kanban e refazer.
--
-- 📌 Cabecalho, valores, projeto, validade, pagamento e observacoes ficam SEMPRE editaveis.
-- 📌 Toda edicao de orcamento ganho deixa rastro na Central: e intervencao manual em dado que
-- alimenta faturamento e chao de fabrica.

CREATE OR REPLACE FUNCTION public.save_orcamento(
  p_id uuid,
  p_clinic_id uuid,
  p_lead_id uuid,
  p_status text DEFAULT 'rascunho'::text,
  p_client_name text DEFAULT NULL::text,
  p_client_doc text DEFAULT NULL::text,
  p_client_address text DEFAULT NULL::text,
  p_subtotal numeric DEFAULT NULL::numeric,
  p_desconto numeric DEFAULT NULL::numeric,
  p_frete numeric DEFAULT NULL::numeric,
  p_total numeric DEFAULT 0,
  p_validade date DEFAULT NULL::date,
  p_vencimento date DEFAULT NULL::date,
  p_pagamento text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_snapshot jsonb DEFAULT NULL::jsonb,
  p_ticket_id uuid DEFAULT NULL::uuid,
  p_projeto text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id          uuid;
  v_number      integer;
  v_cur         public.orcamentos%ROWTYPE;
  v_open_ticket uuid;
  v_entrega     date := NULLIF(p_snapshot->>'dataEntrega', '')::date;
  v_projeto     text := NULLIF(btrim(p_projeto), '');
  v_ganho       boolean := false;
  v_linhas_mud  boolean := false;
  v_valor_mud   boolean := false;
  v_conv        uuid;
  v_tx          uuid;
  v_prov        jsonb;
  v_libera      int := 0;
  v_cancel      int := 0;
BEGIN
  IF NOT has_clinic_access(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_cur FROM public.orcamentos WHERE id = p_id AND clinic_id = p_clinic_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
    END IF;
    IF v_cur.status NOT IN ('rascunho', 'enviado', 'aprovado') THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'locked_after_approval', 'status', v_cur.status);
    END IF;

    v_ganho      := (v_cur.status = 'aprovado');
    v_linhas_mud := COALESCE(v_cur.snapshot->'lines', '[]'::jsonb) IS DISTINCT FROM COALESCE(p_snapshot->'lines', '[]'::jsonb);
    v_valor_mud  := p_total IS DISTINCT FROM v_cur.total;

    IF v_ganho AND v_linhas_mud THEN
      IF v_cur.entregue_at IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'ja_entregue',
                                  'entregue_at', v_cur.entregue_at);
      END IF;
      IF v_cur.approved_line_keys IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'aprovacao_parcial');
      END IF;
      IF EXISTS (SELECT 1 FROM public.production_orders
                  WHERE orcamento_id = p_id AND status IN ('em_producao', 'concluida')) THEN
        RETURN jsonb_build_object('success', false, 'error_code', 'producao_iniciada');
      END IF;
    END IF;

    UPDATE public.orcamentos SET
      lead_id        = p_lead_id,
      projeto        = COALESCE(v_projeto, projeto),
      client_name    = p_client_name,
      client_doc     = COALESCE(p_client_doc, client_doc),
      client_address = COALESCE(p_client_address, client_address),
      subtotal       = COALESCE(p_subtotal, subtotal),
      desconto       = COALESCE(p_desconto, desconto),
      frete          = COALESCE(p_frete, frete),
      total          = p_total,
      validade       = COALESCE(p_validade, validade),
      vencimento     = COALESCE(p_vencimento, vencimento),
      pagamento      = COALESCE(p_pagamento, pagamento),
      notes          = p_notes,
      snapshot       = p_snapshot,
      data_entrega_prevista = v_entrega,
      status         = CASE WHEN v_cur.status = 'aprovado' THEN 'aprovado'
                            WHEN v_cur.status = 'rascunho' THEN p_status
                            ELSE v_cur.status END,
      sent_at        = CASE WHEN v_cur.status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;

    IF v_ganho THEN
      IF v_linhas_mud THEN
        UPDATE public.stock_reservations
           SET status = 'liberada', released_at = now()
         WHERE orcamento_id = p_id AND status = 'ativa';
        GET DIAGNOSTICS v_libera = ROW_COUNT;

        UPDATE public.production_orders
           SET status = 'cancelada'
         WHERE orcamento_id = p_id AND status = 'planejada';
        GET DIAGNOSTICS v_cancel = ROW_COUNT;

        v_prov := public.provision_orcamento(p_id);
      END IF;

      IF v_valor_mud THEN
        SELECT c.id, c.financial_transaction_id INTO v_conv, v_tx
          FROM public.conversions c WHERE c.id = v_cur.conversion_id;

        IF v_conv IS NOT NULL THEN
          UPDATE public.conversions SET value = p_total WHERE id = v_conv;
          IF v_tx IS NOT NULL THEN
            UPDATE public.financial_transactions SET amount = p_total WHERE id = v_tx;
          END IF;
        END IF;
      END IF;

      PERFORM log_system_error(
        'orcamento', 'editado_apos_ganho',
        'Orçamento já ganho foi editado; venda, receita, estoque e produção foram ajustados junto',
        'warn', p_clinic_id,
        jsonb_build_object('orcamento_id', p_id, 'numero', v_number,
                           'valor_de', v_cur.total, 'valor_para', p_total,
                           'linhas_mudaram', v_linhas_mud,
                           'reservas_liberadas', v_libera, 'ops_canceladas', v_cancel,
                           'reprovisionamento', v_prov,
                           'conversion_id', v_conv, 'financial_transaction_id', v_tx), false);
    END IF;
  ELSE
    INSERT INTO public.orcamentos (
      clinic_id, lead_id, ticket_id, projeto, status, client_name, client_doc, client_address,
      subtotal, desconto, frete, total, validade, vencimento, pagamento, notes, snapshot,
      data_entrega_prevista, created_by, sent_at
    ) VALUES (
      p_clinic_id, p_lead_id, p_ticket_id, v_projeto, p_status, p_client_name, p_client_doc, p_client_address,
      p_subtotal, p_desconto, p_frete, p_total, p_validade, p_vencimento, p_pagamento, p_notes, p_snapshot,
      v_entrega, auth.uid(), CASE WHEN p_status = 'enviado' THEN now() ELSE NULL END
    )
    RETURNING id, number INTO v_id, v_number;
  END IF;

  IF p_lead_id IS NOT NULL THEN
    SELECT id INTO v_open_ticket FROM public.tickets WHERE lead_id = p_lead_id AND status = 'open' LIMIT 1;
    IF v_open_ticket IS NOT NULL THEN
      UPDATE public.tickets SET quote_data = p_snapshot, notes = COALESCE(p_notes, notes) WHERE id = v_open_ticket;
    END IF;
    UPDATE public.leads SET estimated_value = p_total WHERE id = p_lead_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'number', v_number, 'projeto', v_projeto,
                            'ganho_editado', v_ganho, 'linhas_mudaram', v_linhas_mud);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid, text) TO authenticated, service_role;
