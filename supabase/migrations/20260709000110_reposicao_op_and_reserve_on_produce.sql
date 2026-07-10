-- Pacote (pedidos do usuário 09/07):
-- (1) sob_medida também checa estoque e produz só o complemento (some o caso especial de qtd cheia).
-- (2) helper generate_reposicao_op: cria/atualiza A ÚNICA OP de reposição 'planejada' do SKU,
--     dimensionada para repor até o mínimo (min − disponível − reposição em produção, arredondado ao
--     lote) OU com qtd explícita (botão do alerta). Usada pelo provision E pelo botão do Estoque.
-- (3) provision cria OP de cliente com o COMPLEMENTO EXATO (déficit = pedido − disponível), e ao final
--     de cada SKU chama generate_reposicao_op (reposição no fim do grupo, sempre que ficar abaixo do
--     mínimo). Removida a lógica de "produção livre/prazo compatível" no déficit do cliente — a
--     reposição agora é OP separada de refil, não um pool que cobre pedidos.
-- (4) ACERTO DE ESTOQUE (desenho do usuário): concluir uma OP de cliente RESERVA a peça produzida
--     para o pedido dela (a OP guarda orcamento_id). Assim a baixa na entrega (gatilho já existente
--     fn_settle_reservations_on_resolve) encontra tudo reservado — o produzido deixa de virar
--     "fantasma" no estoque. Cancelamento do pedido já solta essas reservas (fn_orcamento_revert...).

-- (2) -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_reposicao_op(p_item_id uuid, p_qty numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item   public.inventory_items%ROWTYPE;
  v_reserv numeric;
  v_disp   numeric;
  v_emprod numeric;
  v_needed numeric;
  v_target numeric;
  v_op     public.production_orders%ROWTYPE;
  v_newid  uuid;
BEGIN
  SELECT * INTO v_item FROM public.inventory_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'item_not_found'); END IF;
  IF NOT has_clinic_access(v_item.clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;

  IF p_qty IS NOT NULL THEN
    v_target := p_qty;
  ELSE
    IF COALESCE(v_item.min_qty, 0) <= 0 THEN
      RETURN jsonb_build_object('success', true, 'skipped', 'sem_minimo');
    END IF;
    SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
    v_disp := v_item.current_qty - v_reserv;
    SELECT COALESCE(SUM(qty_planned), 0) INTO v_emprod FROM public.production_orders
      WHERE product_item_id = v_item.id AND tipo = 'reposicao' AND status = 'em_producao';
    v_needed := v_item.min_qty - (v_disp + v_emprod);
    IF v_needed <= 0 THEN RETURN jsonb_build_object('success', true, 'skipped', 'acima_do_minimo'); END IF;
    IF COALESCE(v_item.lote_minimo, 0) > 0 THEN
      v_target := ceil(v_needed / v_item.lote_minimo) * v_item.lote_minimo;
    ELSE
      v_target := v_needed;
    END IF;
  END IF;

  IF COALESCE(v_target, 0) <= 0 THEN RETURN jsonb_build_object('success', true, 'skipped', 'zero'); END IF;

  -- A ÚNICA OP de reposição 'planejada' do SKU (create-or-update). Auto = cresce (nunca encolhe);
  -- manual (p_qty) = seta o valor que o operador confirmou.
  SELECT * INTO v_op FROM public.production_orders
    WHERE product_item_id = v_item.id AND tipo = 'reposicao' AND status = 'planejada'
    ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE public.production_orders
      SET qty_planned = CASE WHEN p_qty IS NOT NULL THEN v_target ELSE GREATEST(qty_planned, v_target) END
      WHERE id = v_op.id;
    RETURN jsonb_build_object('success', true, 'op_id', v_op.id, 'qty', v_target, 'updated', true);
  ELSE
    INSERT INTO public.production_orders
      (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, status, created_by)
    VALUES
      (v_item.clinic_id, v_item.id, v_item.name, v_target, v_item.altura, 'reposicao', 'planejada', auth.uid())
    RETURNING id INTO v_newid;
    RETURN jsonb_build_object('success', true, 'op_id', v_newid, 'qty', v_target, 'created', true);
  END IF;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.generate_reposicao_op(uuid, numeric) FROM PUBLIC, anon;

-- (1)+(3) --------------------------------------------------------------------------------------------
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
  v_deficit  numeric;
  v_tores    numeric;
  v_reserved numeric := 0;
  v_ops      int := 0;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND OR NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
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

    -- Resolver/criar o SKU concreto (idêntico ao anterior)
    IF v_baseprod.altura IS NOT NULL THEN
      SELECT * INTO v_item FROM public.inventory_items
        WHERE clinic_id = v_orc.clinic_id AND product_id = v_prod AND kind = 'produto_acabado' AND is_active = true
        LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
    ELSIF COALESCE(v_altln, 0) > 0 AND EXISTS (SELECT 1 FROM public.products ch WHERE ch.base_product_id = v_prod) THEN
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
      SELECT * INTO v_item FROM public.inventory_items
        WHERE clinic_id = v_orc.clinic_id AND product_id = v_prod AND kind = 'produto_acabado' AND is_active = true
        LIMIT 1 FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;

    -- (1) TODOS os tipos (inclusive sob_medida) checam estoque: reserva o que tem, produz o complemento.
    SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
    v_disp := v_item.current_qty - v_reserv;

    v_tores := LEAST(v_comp, GREATEST(v_disp, 0));
    IF v_tores > 0 THEN
      INSERT INTO public.stock_reservations (clinic_id, item_id, orcamento_id, qty, created_by)
      VALUES (v_orc.clinic_id, v_item.id, p_orcamento_id, v_tores, auth.uid());
      v_reserved := v_reserved + v_tores;
    END IF;

    -- (3) OP de CLIENTE = complemento EXATO (sem arredondar ao lote — o lote fica com a reposição).
    v_deficit := v_comp - GREATEST(v_disp, 0);
    IF v_deficit > 0 THEN
      INSERT INTO public.production_orders
        (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, due_date, created_by)
      VALUES
        (v_orc.clinic_id, v_item.id, v_item.name, v_deficit, v_item.altura, 'vinculada', p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, v_orc.data_entrega_prevista, auth.uid());
      v_ops := v_ops + 1;
    END IF;

    -- (3) Reposição no fim do grupo: repõe até o mínimo sempre que este pedido derrubar o disponível
    -- abaixo do mínimo (a função pula sozinha se não precisar / se não tiver mínimo, ex.: sob_medida).
    PERFORM public.generate_reposicao_op(v_item.id);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reserved', v_reserved, 'ops', v_ops);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.provision_orcamento(uuid) FROM PUBLIC, anon;

-- (4) --------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_production_order(p_order_id uuid, p_qty_produced numeric, p_altura numeric DEFAULT NULL::numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order public.production_orders%ROWTYPE;
  v_qty   numeric := GREATEST(COALESCE(p_qty_produced, 0), 0);
  v_alt   numeric;
  v_bom   record;
BEGIN
  SELECT * INTO v_order FROM public.production_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'order_not_found'); END IF;
  IF NOT has_clinic_access(v_order.clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF v_order.status = 'concluida' THEN RETURN jsonb_build_object('success', true, 'already_done', true); END IF;
  IF v_order.status = 'cancelada' THEN RETURN jsonb_build_object('success', false, 'error_code', 'order_cancelled'); END IF;

  v_alt := COALESCE(p_altura, v_order.altura);

  UPDATE public.production_orders
     SET qty_produced = v_qty, status = 'concluida', finished_at = now(),
         started_at = COALESCE(started_at, now()), altura = COALESCE(p_altura, altura)
   WHERE id = p_order_id;

  IF v_order.product_item_id IS NOT NULL AND v_qty > 0 THEN
    FOR v_bom IN
      SELECT material_item_id, qty_per_unit FROM public.product_bom
       WHERE product_item_id = v_order.product_item_id AND qty_per_unit > 0
    LOOP
      INSERT INTO public.inventory_movements (clinic_id, item_id, type, qty, reason, production_order_id, created_by)
      VALUES (v_order.clinic_id, v_bom.material_item_id, 'saida', v_bom.qty_per_unit * v_qty, 'consumo_producao', p_order_id, auth.uid());
    END LOOP;

    INSERT INTO public.inventory_movements (clinic_id, item_id, type, qty, reason, production_order_id, altura, created_by)
    VALUES (v_order.clinic_id, v_order.product_item_id, 'entrada', v_qty, 'producao', p_order_id, v_alt, auth.uid());

    -- (4) OP de CLIENTE (vinculada a um pedido): a peça produzida é RESERVADA para o pedido dela,
    -- para a baixa na entrega (fn_settle_reservations_on_resolve) encontrá-la. Reposição (orcamento_id
    -- NULL) NÃO reserva — vai para o estoque geral (refil da prateleira).
    IF v_order.orcamento_id IS NOT NULL AND v_order.tipo = 'vinculada' THEN
      INSERT INTO public.stock_reservations (clinic_id, item_id, orcamento_id, qty, created_by)
      VALUES (v_order.clinic_id, v_order.product_item_id, v_order.orcamento_id, v_qty, auth.uid());
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
END;
$function$;
