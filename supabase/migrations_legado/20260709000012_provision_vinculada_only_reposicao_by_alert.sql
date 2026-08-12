-- Correção de regra de negócio: na APROVAÇÃO só gera OP VINCULADA (o déficit do pedido — cliente
-- esperando). A REPOSIÇÃO (repor até o estoque mínimo) NÃO é automática: vira ALERTA
-- (precisa_reposicao na view vw_inventory_available) que o OPERADOR vê e programa manualmente
-- (Nova OP no módulo Produção). Assim o chão de fábrica não é inundado de OP de reposição a cada
-- venda. Validado: A) sem estoque, pedido 200 → OP 300 vinculada; B) 500 estoque, pedido 450 →
-- reserva 450, 0 OP, precisa_reposicao=true (disponível 50 < mínimo 100).
CREATE OR REPLACE FUNCTION public.provision_orcamento(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orc     public.orcamentos%ROWTYPE;
  v_rec     record;
  v_prod    uuid;
  v_item    public.inventory_items%ROWTYPE;
  v_comp    numeric;
  v_reserv  numeric;
  v_disp    numeric;
  v_livre   numeric;
  v_deficit numeric;
  v_tores   numeric;
  v_qtdop   numeric;
  v_reserved numeric := 0;
  v_ops     int := 0;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND OR NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
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
        (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, created_by)
      VALUES
        (v_orc.clinic_id, v_item.id, v_item.name, v_comp, v_item.altura, 'vinculada', p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, auth.uid());
      v_ops := v_ops + 1;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
    v_disp := v_item.current_qty - v_reserv;
    SELECT COALESCE(SUM(qty_planned), 0) INTO v_livre FROM public.production_orders
      WHERE product_item_id = v_item.id AND tipo = 'reposicao' AND status IN ('planejada', 'em_producao');

    v_tores := LEAST(v_comp, GREATEST(v_disp, 0));
    IF v_tores > 0 THEN
      INSERT INTO public.stock_reservations (clinic_id, item_id, orcamento_id, qty, created_by)
      VALUES (v_orc.clinic_id, v_item.id, p_orcamento_id, v_tores, auth.uid());
      v_reserved := v_reserved + v_tores;
    END IF;

    -- OP VINCULADA só do que o PEDIDO não cobre. Reposição até o mínimo NÃO é automática (alerta).
    v_deficit := v_comp - (v_disp + v_livre);
    IF v_deficit > 0 THEN
      IF COALESCE(v_item.lote_minimo, 0) > 0 THEN
        v_qtdop := ceil(v_deficit / v_item.lote_minimo) * v_item.lote_minimo;
      ELSE
        v_qtdop := v_deficit;
      END IF;
      INSERT INTO public.production_orders
        (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, created_by)
      VALUES
        (v_orc.clinic_id, v_item.id, v_item.name, v_qtdop, v_item.altura, 'vinculada', p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, auth.uid());
      v_ops := v_ops + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reserved', v_reserved, 'ops', v_ops);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.provision_orcamento(uuid) FROM PUBLIC, anon;

-- View com o ALERTA de estoque mínimo (o que o operador vê para programar a reposição).
CREATE OR REPLACE VIEW public.vw_inventory_available
WITH (security_invoker = true) AS
SELECT ii.*,
  COALESCE((SELECT SUM(r.qty) FROM public.stock_reservations r WHERE r.item_id = ii.id AND r.status = 'ativa'), 0) AS reserved_qty,
  ii.current_qty - COALESCE((SELECT SUM(r.qty) FROM public.stock_reservations r WHERE r.item_id = ii.id AND r.status = 'ativa'), 0) AS available_qty,
  COALESCE((SELECT SUM(po.qty_planned) FROM public.production_orders po WHERE po.product_item_id = ii.id AND po.tipo = 'reposicao' AND po.status IN ('planejada','em_producao')), 0) AS reposicao_qty,
  (ii.min_qty > 0 AND
   (ii.current_qty
    - COALESCE((SELECT SUM(r.qty) FROM public.stock_reservations r WHERE r.item_id = ii.id AND r.status = 'ativa'), 0)
    + COALESCE((SELECT SUM(po.qty_planned) FROM public.production_orders po WHERE po.product_item_id = ii.id AND po.tipo = 'reposicao' AND po.status IN ('planejada','em_producao')), 0)
   ) < ii.min_qty
  ) AS precisa_reposicao
FROM public.inventory_items ii;
