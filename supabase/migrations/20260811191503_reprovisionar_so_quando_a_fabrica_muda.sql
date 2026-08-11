-- Refino da edicao de orcamento ganho: reprovisionar SO quando a FABRICA muda.
--
-- ⚠️ O PROBLEMA que isto corrige, medido em transacao revertida no orcamento #99 da Metaltres:
-- a versao anterior (20260811191056) disparava o reprovisionamento sempre que o array `lines`
-- mudasse. So que a linha guarda `fee`, `qty`, `price`, `altura`, `discount` e `productId` no mesmo
-- objeto, e `provision_orcamento` le APENAS `productId`, `qty` e `altura`. Resultado: dar um
-- desconto (o caso mais comum de edicao) cancelava a ordem de producao e emitia outra, com numero
-- novo, para o mesmo servico fisico. A fabrica via tres ordens onde havia um trabalho so.
--
-- 📌 A regra passa a ser a IMPRESSAO DIGITAL DE PRODUCAO: produto, quantidade e altura de cada
-- linha aprovada, e mais nada. Mexeu nisso, a fabrica e refeita; mexeu em dinheiro ou texto, nao.
--
-- ⚠️ A comparacao e NUMERICA, nao textual: a tela grava '110' num salvamento e '110.0' ou '110,0'
-- noutro, e comparar como texto acusaria mudanca onde nao houve, devolvendo a reemissao a toa que
-- esta migration existe para matar. Por isso o cast para numeric, com a virgula trocada por ponto.
--
-- PROVADO em transacao revertida (11/08, orcamento #99, OP #9 planejada de 110m):
--   fingerprint('110'/'1,8') = fingerprint('110.0'/'1.8')  -> nao acusa mudanca;
--   editar SO preco e desconto -> producao_refeita=false, OP #9 intacta, venda foi para 2.200;
--   editar a quantidade p/ 200 -> producao_refeita=true, OP #9 cancelada, OP #13 planejada 200;
--   salvar sem mudar nada      -> producao_refeita=false, e nada vai para a Central.

CREATE OR REPLACE FUNCTION public.fn_orcamento_prov_fingerprint(
  p_snapshot jsonb,
  p_keys text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT COALESCE(jsonb_object_agg('L' || t.ord, jsonb_build_array(
           t.elem->>'productId',
           NULLIF(replace(COALESCE(t.elem->>'qty', ''), ',', '.'), '')::numeric,
           NULLIF(replace(COALESCE(t.elem->>'altura', ''), ',', '.'), '')::numeric
         )), '{}'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_snapshot->'lines', '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  WHERE p_keys IS NULL OR ('L' || t.ord) = ANY (p_keys);
$function$;

COMMENT ON FUNCTION public.fn_orcamento_prov_fingerprint(jsonb, text[]) IS
  'Só o que provision_orcamento lê de cada linha aprovada (produto, quantidade, altura). Serve para '
  'decidir se uma edição de orçamento ganho precisa refazer estoque e produção. Mudança de preço, '
  'desconto, frete ou texto NÃO altera esta impressão digital.';

-- ─────────────────────────────────────────────────────────────────────────────
-- `save_orcamento` passa a usar a impressao digital no lugar da comparacao crua de `lines`.
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
    -- Recusado, expirado e substituido continuam trancados: sao saidas terminais, e reabrir um
    -- documento morto por edicao esconderia o desfecho.
    IF v_cur.status NOT IN ('rascunho', 'enviado', 'aprovado') THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'locked_after_approval', 'status', v_cur.status);
    END IF;

    v_ganho     := (v_cur.status = 'aprovado');
    v_valor_mud := p_total IS DISTINCT FROM v_cur.total;
    -- ⚠️ Impressao digital, nao o array cru: preco e desconto moram DENTRO da linha e nao interessam
    -- para a fabrica. O escopo aprovado e o gravado, que a edicao nao muda.
    v_linhas_mud := public.fn_orcamento_prov_fingerprint(v_cur.snapshot, v_cur.approved_line_keys)
                    IS DISTINCT FROM
                    public.fn_orcamento_prov_fingerprint(p_snapshot, v_cur.approved_line_keys);

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
      -- ⚠️ COALESCE: salvar sem informar NAO apaga o que ja estava la.
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
      -- Orcamento ganho NAO volta para rascunho/enviado ao ser editado.
      status         = CASE WHEN v_cur.status = 'aprovado' THEN 'aprovado'
                            WHEN v_cur.status = 'rascunho' THEN p_status
                            ELSE v_cur.status END,
      sent_at        = CASE WHEN v_cur.status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;

    IF v_ganho THEN
      -- 1) ESTOQUE E PRODUCAO: so quando a impressao digital muda.
      --    ⚠️ Cancelar ANTES de reprovisionar nao e detalhe: o indice
      --    `production_orders_orcamento_line_uidx` e unico por (orcamento, linha) e so ignora o que
      --    esta 'cancelada'. Reprovisionar sem cancelar da 23505 e derruba a gravacao inteira.
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

      -- 2) DINHEIRO: a venda e a receita acompanham o documento do cliente.
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

      -- So registra quando algo de fato mudou: salvar sem alterar nada nao e intervencao.
      IF v_linhas_mud OR v_valor_mud THEN
        PERFORM log_system_error(
          'orcamento', 'editado_apos_ganho',
          'Orçamento já ganho foi editado; venda, receita, estoque e produção foram ajustados junto',
          'warn', p_clinic_id,
          jsonb_build_object('orcamento_id', p_id, 'numero', v_number,
                             'valor_de', v_cur.total, 'valor_para', p_total,
                             'producao_refeita', v_linhas_mud,
                             'reservas_liberadas', v_libera, 'ops_canceladas', v_cancel,
                             'reprovisionamento', v_prov,
                             'conversion_id', v_conv, 'financial_transaction_id', v_tx), false);
      END IF;
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
                            'ganho_editado', v_ganho, 'producao_refeita', v_linhas_mud);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_orcamento_prov_fingerprint(jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_orcamento_prov_fingerprint(jsonb, text[]) TO authenticated, service_role;
