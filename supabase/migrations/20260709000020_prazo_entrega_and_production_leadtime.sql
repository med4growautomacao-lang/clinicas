-- Passo 4 do motor de produção: "prazo compatível" na produção livre.
-- Uma OP de reposição aberta só abate a necessidade DESTE pedido se ficar pronta a tempo de
-- entregar na data prometida. Se não ficar, o pedido gera OP vinculada própria.
--
-- Peças novas:
--   * orcamentos.data_entrega_prevista  — data prometida de entrega do pedido (setada no OrcamentoModal,
--     transportada dentro do snapshot em `dataEntrega`; save_orcamento materializa na coluna).
--   * clinics.lead_time_expedicao_dias  — folga (dias) entre "OP pronta" e "entregar" (separar/expedir).
--     Default 0 = sem folga (inerte até a fábrica configurar).
--   * provision_orcamento passa a contar como produção livre só as OPs de reposição cuja data de
--     conclusão estimada (due_date OU created_at + lead_time_producao do SKU) cabe no prazo.

ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS data_entrega_prevista date;
ALTER TABLE public.clinics    ADD COLUMN IF NOT EXISTS lead_time_expedicao_dias integer NOT NULL DEFAULT 0;

-- save_orcamento: mesma assinatura (sem novo parâmetro — evita overload); materializa
-- data_entrega_prevista a partir do snapshot->>'dataEntrega'.
CREATE OR REPLACE FUNCTION public.save_orcamento(
  p_id uuid, p_clinic_id uuid, p_lead_id uuid, p_status text DEFAULT 'rascunho'::text,
  p_client_name text DEFAULT NULL::text, p_client_doc text DEFAULT NULL::text, p_client_address text DEFAULT NULL::text,
  p_subtotal numeric DEFAULT NULL::numeric, p_desconto numeric DEFAULT NULL::numeric, p_frete numeric DEFAULT NULL::numeric,
  p_total numeric DEFAULT 0, p_validade date DEFAULT NULL::date, p_vencimento date DEFAULT NULL::date,
  p_pagamento text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_snapshot jsonb DEFAULT NULL::jsonb,
  p_ticket_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id          uuid;
  v_number      integer;
  v_cur_status  text;
  v_open_ticket uuid;
  v_entrega     date := NULLIF(p_snapshot->>'dataEntrega', '')::date;
BEGIN
  IF NOT has_clinic_access(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT status INTO v_cur_status FROM public.orcamentos WHERE id = p_id AND clinic_id = p_clinic_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
    END IF;
    IF v_cur_status NOT IN ('rascunho', 'enviado') THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'locked_after_approval', 'status', v_cur_status);
    END IF;

    UPDATE public.orcamentos SET
      lead_id        = p_lead_id,
      client_name    = p_client_name,
      client_doc     = p_client_doc,
      client_address = p_client_address,
      subtotal       = p_subtotal,
      desconto       = p_desconto,
      frete          = p_frete,
      total          = p_total,
      validade       = p_validade,
      vencimento     = p_vencimento,
      pagamento      = p_pagamento,
      notes          = p_notes,
      snapshot       = p_snapshot,
      data_entrega_prevista = v_entrega,
      status         = CASE WHEN status = 'rascunho' THEN p_status ELSE status END,
      sent_at        = CASE WHEN status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;
  ELSE
    INSERT INTO public.orcamentos (
      clinic_id, lead_id, ticket_id, status, client_name, client_doc, client_address,
      subtotal, desconto, frete, total, validade, vencimento, pagamento, notes, snapshot,
      data_entrega_prevista, created_by, sent_at
    ) VALUES (
      p_clinic_id, p_lead_id, p_ticket_id, p_status, p_client_name, p_client_doc, p_client_address,
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

  RETURN jsonb_build_object('success', true, 'id', v_id, 'number', v_number);
END;
$function$;

-- provision_orcamento: produção livre agora filtra por prazo (só reposição que fica pronta a tempo).
CREATE OR REPLACE FUNCTION public.provision_orcamento(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orc      public.orcamentos%ROWTYPE;
  v_rec      record;
  v_prod     uuid;
  v_item     public.inventory_items%ROWTYPE;
  v_comp     numeric;
  v_reserv   numeric;
  v_disp     numeric;
  v_livre    numeric;
  v_deficit  numeric;
  v_tores    numeric;
  v_qtdop    numeric;
  v_exp      int  := 0;
  v_deadline date;              -- data-limite p/ a OP estar PRONTA (entrega − expedição)
  v_reserved numeric := 0;
  v_ops      int := 0;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND OR NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT COALESCE(lead_time_expedicao_dias, 0) INTO v_exp FROM public.clinics WHERE id = v_orc.clinic_id;
  v_deadline := v_orc.data_entrega_prevista;
  IF v_deadline IS NOT NULL AND COALESCE(v_exp, 0) > 0 THEN
    v_deadline := v_deadline - v_exp;   -- precisa ficar pronta v_exp dias antes p/ dar tempo de expedir
  END IF;

  FOR v_rec IN
    SELECT (elem->>'productId') AS pid,
           NULLIF(replace(COALESCE(elem->>'qty',''), ',', '.'), '')::numeric AS qty,
           ord
    FROM jsonb_array_elements(COALESCE(v_orc.snapshot->'lines', '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  LOOP
    IF v_rec.pid IS NULL OR left(v_rec.pid, 2) <> 'p:' THEN CONTINUE; END IF;
    v_prod := substring(v_rec.pid FROM 3)::uuid;
    v_comp := COALESCE(v_rec.qty, 0);
    IF v_comp <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_item FROM public.inventory_items
      WHERE clinic_id = v_orc.clinic_id AND product_id = v_prod AND kind = 'produto_acabado' AND is_active = true
      LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_item.tipo = 'sob_medida' THEN
      INSERT INTO public.production_orders
        (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, due_date, created_by)
      VALUES
        (v_orc.clinic_id, v_item.id, v_item.name, v_comp, v_item.altura, 'vinculada', p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, v_orc.data_entrega_prevista, auth.uid());
      v_ops := v_ops + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
    v_disp := v_item.current_qty - v_reserv;

    -- Produção livre: OPs de reposição abertas que ficam prontas a tempo. Sem prazo no pedido
    -- (v_deadline NULL) conta todas (comportamento anterior). Data de conclusão estimada da OP =
    -- due_date, ou created_at (SP) + lead_time_producao do SKU.
    SELECT COALESCE(SUM(po.qty_planned), 0) INTO v_livre
    FROM public.production_orders po
    WHERE po.product_item_id = v_item.id
      AND po.tipo = 'reposicao'
      AND po.status IN ('planejada', 'em_producao')
      AND (
        v_deadline IS NULL
        OR COALESCE(
             po.due_date,
             (po.created_at AT TIME ZONE 'America/Sao_Paulo')::date + COALESCE(v_item.lead_time_producao, 0)
           ) <= v_deadline
      );

    v_tores := LEAST(v_comp, GREATEST(v_disp, 0));
    IF v_tores > 0 THEN
      INSERT INTO public.stock_reservations (clinic_id, item_id, orcamento_id, qty, created_by)
      VALUES (v_orc.clinic_id, v_item.id, p_orcamento_id, v_tores, auth.uid());
      v_reserved := v_reserved + v_tores;
    END IF;

    -- OP VINCULADA só do que o PEDIDO não cobre (disponível + reposição a tempo). Reposição até o
    -- mínimo NÃO é automática (vira alerta precisa_reposicao).
    v_deficit := v_comp - (v_disp + v_livre);
    IF v_deficit > 0 THEN
      IF COALESCE(v_item.lote_minimo, 0) > 0 THEN
        v_qtdop := ceil(v_deficit / v_item.lote_minimo) * v_item.lote_minimo;
      ELSE
        v_qtdop := v_deficit;
      END IF;
      INSERT INTO public.production_orders
        (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, due_date, created_by)
      VALUES
        (v_orc.clinic_id, v_item.id, v_item.name, v_qtdop, v_item.altura, 'vinculada', p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, v_orc.data_entrega_prevista, auth.uid());
      v_ops := v_ops + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reserved', v_reserved, 'ops', v_ops);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.provision_orcamento(uuid) FROM PUBLIC, anon;
