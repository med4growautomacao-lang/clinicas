-- Orçamento volta a ter ALTURA LIVRE (fluxo ágil antigo), sem perder o estoque por altura.
-- No orçamento você escolhe o MODELO (Fio 14 - 3"…) e digita a altura:
--   * altura que já tem SKU  -> a venda VINCULA a esse SKU (reserva/estoque como hoje);
--   * altura inédita         -> a venda CRIA um SKU 'sob_medida' (make-to-order, sem estoque) e faz OP direta.
-- O produto novo só nasce na APROVAÇÃO (aqui, dentro do provision) — não polui o catálogo com
-- orçamento que não fecha. Cada altura continua sendo o SKU que estoca/reserva/produz.
--
-- Peças: products.base_product_id (liga SKU de altura -> modelo base) + backfill + reativa os
-- modelos base; provision_orcamento passa a RESOLVER-OU-CRIAR o SKU por linha.

-- 1) Vínculo SKU(altura) -> modelo base
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS base_product_id uuid REFERENCES public.products(id) ON DELETE SET NULL;

-- 2) Backfill: cada SKU de altura aponta para seu modelo base (mesmo clínica, nome "base — Xm")
UPDATE public.products sku
SET base_product_id = base.id
FROM public.products base
WHERE sku.altura IS NOT NULL
  AND sku.base_product_id IS NULL
  AND base.altura IS NULL
  AND base.clinic_id = sku.clinic_id
  AND sku.name LIKE base.name || ' — %';

-- 3) Reativa os modelos base que têm SKUs de altura (voltam a ser escolhíveis no orçamento)
UPDATE public.products
SET is_active = true
WHERE altura IS NULL
  AND id IN (SELECT DISTINCT base_product_id FROM public.products WHERE base_product_id IS NOT NULL);

-- 4) provision_orcamento: resolve-ou-cria o SKU por linha (modelo base + altura), mantendo o
--    passo 4 (produção livre por prazo) e a reserva/algoritmo.
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
  v_baseprod public.products%ROWTYPE;
  v_item     public.inventory_items%ROWTYPE;
  v_altln    numeric;
  v_lbl      text;
  v_newprod  uuid;
  v_comp     numeric;
  v_reserv   numeric;
  v_disp     numeric;
  v_livre    numeric;
  v_deficit  numeric;
  v_tores    numeric;
  v_qtdop    numeric;
  v_exp      int  := 0;
  v_deadline date;
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
    v_deadline := v_deadline - v_exp;
  END IF;

  FOR v_rec IN
    SELECT (elem->>'productId') AS pid,
           NULLIF(replace(COALESCE(elem->>'qty',''), ',', '.'), '')::numeric AS qty,
           NULLIF(replace(COALESCE(elem->>'altura',''), ',', '.'), '')::numeric AS altura,
           ord
    FROM jsonb_array_elements(COALESCE(v_orc.snapshot->'lines', '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  LOOP
    IF v_rec.pid IS NULL OR left(v_rec.pid, 2) <> 'p:' THEN CONTINUE; END IF;
    v_prod  := substring(v_rec.pid FROM 3)::uuid;
    v_comp  := COALESCE(v_rec.qty, 0);
    v_altln := v_rec.altura;
    IF v_comp <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_baseprod FROM public.products WHERE id = v_prod;
    IF NOT FOUND THEN CONTINUE; END IF;

    -- ---- Resolver o SKU concreto (v_item) -----------------------------------------------------
    IF v_baseprod.altura IS NOT NULL THEN
      -- Linha já aponta para um SKU de altura (orçamentos antigos / seleção direta).
      SELECT * INTO v_item FROM public.inventory_items
        WHERE clinic_id = v_orc.clinic_id AND product_id = v_prod AND kind = 'produto_acabado' AND is_active = true
        LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;

    ELSIF COALESCE(v_altln, 0) > 0 AND EXISTS (SELECT 1 FROM public.products ch WHERE ch.base_product_id = v_prod) THEN
      -- Modelo base (tela) + altura: resolve o SKU daquela altura; se não existir, cria sob_medida.
      SELECT ii.* INTO v_item
        FROM public.inventory_items ii JOIN public.products p ON p.id = ii.product_id
        WHERE ii.clinic_id = v_orc.clinic_id AND p.base_product_id = v_prod AND p.altura = v_altln
          AND p.is_active = true AND ii.kind = 'produto_acabado' AND ii.is_active = true
        LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN
        v_lbl := replace(rtrim(rtrim(v_altln::text, '0'), '.'), '.', ',');
        INSERT INTO public.products
          (clinic_id, name, description, unit, unit_price, attributes, charge_by_area, altura, tipo, base_product_id, is_active)
        VALUES
          (v_orc.clinic_id, v_baseprod.name || ' — ' || v_lbl || 'm', v_baseprod.description, 'm',
           v_baseprod.unit_price, v_baseprod.attributes, false, v_altln, 'sob_medida', v_prod, true)
        RETURNING id INTO v_newprod;
        INSERT INTO public.inventory_items
          (clinic_id, kind, name, unit, tipo, altura, current_qty, min_qty, lote_minimo, lead_time_producao, product_id, is_active)
        VALUES
          (v_orc.clinic_id, 'produto_acabado', v_baseprod.name || ' — ' || v_lbl || 'm', 'm', 'sob_medida', v_altln,
           0, 0, 0, 0, v_newprod, true)
        RETURNING * INTO v_item;
      END IF;

    ELSE
      -- Produto normal (não-tela): comportamento atual (baixa direta por product_id, se houver item).
      SELECT * INTO v_item FROM public.inventory_items
        WHERE clinic_id = v_orc.clinic_id AND product_id = v_prod AND kind = 'produto_acabado' AND is_active = true
        LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;

    -- ---- sob_medida: OP direta da qtd exata, sem reservar --------------------------------------
    IF v_item.tipo = 'sob_medida' THEN
      INSERT INTO public.production_orders
        (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, due_date, created_by)
      VALUES
        (v_orc.clinic_id, v_item.id, v_item.name, v_comp, v_item.altura, 'vinculada', p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, v_orc.data_entrega_prevista, auth.uid());
      v_ops := v_ops + 1;
      CONTINUE;
    END IF;

    -- ---- estocável: reserva + OP vinculada do déficit (produção livre filtrada por prazo) -------
    SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
    v_disp := v_item.current_qty - v_reserv;

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
