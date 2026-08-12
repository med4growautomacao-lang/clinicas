-- Melhoria da provision_orcamento: OP de reposição também guarda orcamento_id (rastreabilidade da
-- venda que disparou o restock + idempotência via índice orcamento_id+line_key). A alocação
-- (vinculada×reposição) é definida pelo `tipo`, não pelo vínculo — a produção livre filtra por
-- tipo='reposicao'. Validado por 2 cenários: sem estoque→OP vinculada; estoque parcial→reserva+OP reposição.
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
  v_projpos numeric;
  v_tores   numeric;
  v_nec     numeric;
  v_qtdop   numeric;
  v_tipoop  text;
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
    v_projpos := (v_disp + v_livre) - v_comp;

    v_tores := LEAST(v_comp, GREATEST(v_disp, 0));
    IF v_tores > 0 THEN
      INSERT INTO public.stock_reservations (clinic_id, item_id, orcamento_id, qty, created_by)
      VALUES (v_orc.clinic_id, v_item.id, p_orcamento_id, v_tores, auth.uid());
      v_reserved := v_reserved + v_tores;
    END IF;

    IF v_projpos >= COALESCE(v_item.min_qty, 0) THEN CONTINUE; END IF;
    v_nec := COALESCE(v_item.min_qty, 0) - v_projpos;
    IF COALESCE(v_item.lote_minimo, 0) > 0 THEN
      v_qtdop := ceil(v_nec / v_item.lote_minimo) * v_item.lote_minimo;
    ELSE
      v_qtdop := v_nec;
    END IF;
    v_tipoop := CASE WHEN v_projpos < 0 THEN 'vinculada' ELSE 'reposicao' END;

    INSERT INTO public.production_orders
      (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, created_by)
    VALUES
      (v_orc.clinic_id, v_item.id, v_item.name, v_qtdop, v_item.altura, v_tipoop,
       p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, auth.uid());
    v_ops := v_ops + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reserved', v_reserved, 'ops', v_ops);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.provision_orcamento(uuid) FROM PUBLIC, anon;
