-- Aprovar só ALGUNS itens do orçamento. Caso real: a fábrica cota 2 opções (fio grosso e fio fino)
-- e o cliente escolhe uma. Na tela de aprovar o vendedor marca quais itens viram pedido/OP.
--   * orcamentos.approved_line_keys text[]  -> chaves das linhas aprovadas ('L1','L2'… = ordinal da
--     linha no snapshot, a MESMA chave que o provision usa em orcamento_line_key). NULL = todas.
--   * close_sale_from_orcamento ganha p_line_keys + p_total: grava a seleção, usa o total VENDIDO
--     (só dos itens escolhidos) na receita/conversão, e persiste orcamentos.total = total vendido.
--     O snapshot continua com as 2 opções (a cotação original não se perde).
--   * provision_orcamento passa a pular as linhas não aprovadas (lê approved_line_keys do orçamento).

ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS approved_line_keys text[];

-- provision: só provisiona as linhas aprovadas -----------------------------------------------------
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
    -- Linha não aprovada (o cliente escolheu a outra opção) -> não vira pedido nem OP.
    IF v_orc.approved_line_keys IS NOT NULL AND NOT (('L'||v_rec.ord) = ANY (v_orc.approved_line_keys)) THEN
      CONTINUE;
    END IF;

    IF v_rec.pid IS NULL OR left(v_rec.pid, 2) <> 'p:' THEN CONTINUE; END IF;
    v_prod  := substring(v_rec.pid FROM 3)::uuid;
    v_comp  := COALESCE(v_rec.qty, 0);
    v_altln := v_rec.altura;
    IF v_comp <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_baseprod FROM public.products WHERE id = v_prod;
    IF NOT FOUND THEN CONTINUE; END IF;

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

    SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
    v_disp := v_item.current_qty - v_reserv;

    v_tores := LEAST(v_comp, GREATEST(v_disp, 0));
    IF v_tores > 0 THEN
      INSERT INTO public.stock_reservations (clinic_id, item_id, orcamento_id, qty, created_by)
      VALUES (v_orc.clinic_id, v_item.id, p_orcamento_id, v_tores, auth.uid());
      v_reserved := v_reserved + v_tores;
    END IF;

    v_deficit := v_comp - GREATEST(v_disp, 0);
    IF v_deficit > 0 THEN
      INSERT INTO public.production_orders
        (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, due_date, created_by)
      VALUES
        (v_orc.clinic_id, v_item.id, v_item.name, v_deficit, v_item.altura, 'vinculada', p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, v_orc.data_entrega_prevista, auth.uid());
      v_ops := v_ops + 1;
    END IF;

    PERFORM public.generate_reposicao_op(v_item.id);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reserved', v_reserved, 'ops', v_ops);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.provision_orcamento(uuid) FROM PUBLIC, anon;

-- close_sale: recebe a seleção de itens + o total vendido -------------------------------------------
DROP FUNCTION IF EXISTS public.close_sale_from_orcamento(uuid, text, text, date, text, date);

CREATE OR REPLACE FUNCTION public.close_sale_from_orcamento(
  p_orcamento_id uuid,
  p_payment_method text DEFAULT 'pix'::text,
  p_payment_status text DEFAULT 'pago'::text,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_category text DEFAULT 'Venda de produto'::text,
  p_data_entrega date DEFAULT NULL::date,
  p_line_keys text[] DEFAULT NULL::text[],
  p_total numeric DEFAULT NULL::numeric)
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
  v_finalize jsonb;
  v_total    numeric;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_not_found'); END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;
  IF v_orc.validade IS NOT NULL AND v_orc.validade < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_vencido', 'validade', v_orc.validade);
  END IF;
  IF v_orc.lead_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_lead_linked'); END IF;
  IF p_line_keys IS NOT NULL AND array_length(p_line_keys, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'nenhum_item_selecionado');
  END IF;

  -- Total VENDIDO (só dos itens escolhidos). Sem seleção, mantém o total cotado.
  v_total := COALESCE(p_total, v_orc.total);

  SELECT id, outcome, status INTO v_ticket
  FROM public.tickets WHERE lead_id = v_orc.lead_id AND status = 'open' FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_open_ticket'); END IF;
  IF v_ticket.outcome = 'perdido' THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_perdido'); END IF;

  IF v_ticket.outcome = 'ganho' THEN
    UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
      data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista),
      approved_line_keys = COALESCE(p_line_keys, approved_line_keys),
      total = v_total
    WHERE id = p_orcamento_id;
    RETURN jsonb_build_object('success', true, 'already_sold', true, 'ticket_id', v_ticket.id);
  END IF;

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

  INSERT INTO public.conversions (clinic_id, lead_id, ticket_id, value, description, payment_method, converted_at, financial_transaction_id)
  VALUES (v_orc.clinic_id, v_orc.lead_id, v_ticket.id, v_total, 'Orçamento #' || v_orc.number, p_payment_method, (p_payment_date::timestamp + interval '12 hour'), v_tx_id);

  SELECT public.finalize_ticket(v_ticket.id, 'ganho', NULL, NULL, false) INTO v_finalize;
  IF NOT COALESCE((v_finalize->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'finalize_ticket falhou ao aprovar orçamento %: %', p_orcamento_id, v_finalize->>'error_code';
  END IF;

  -- Grava seleção + prazo + total vendido ANTES do provision (que lê approved_line_keys e a data).
  UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
    data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista),
    approved_line_keys = COALESCE(p_line_keys, approved_line_keys),
    total = v_total
  WHERE id = p_orcamento_id;

  PERFORM public.provision_orcamento(p_orcamento_id);

  RETURN jsonb_build_object('success', true, 'ticket_id', v_ticket.id, 'financial_transaction_id', v_tx_id, 'patient_id', v_patient, 'total', v_total);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text, date, text[], numeric) FROM PUBLIC, anon;
