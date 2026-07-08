-- Estoque de tela por ALTURA (modelo: altura como atributo da movimentacao).
-- inventory_movements.altura carimba a faixa de altura de cada entrada/saida/produção;
-- o saldo por altura sai da soma das movimentacoes agrupada por (item, altura).
-- production_orders.altura guarda a altura da OP (usada na baixa/entrada ao concluir).

ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS altura numeric;
ALTER TABLE public.production_orders   ADD COLUMN IF NOT EXISTS altura numeric;

-- Recria as RPCs de producao adicionando a altura (param opcional, retrocompatível).
-- register_production depende de complete_production_order -> dropar na ordem certa.
DROP FUNCTION IF EXISTS public.register_production(uuid, uuid, numeric, text);
DROP FUNCTION IF EXISTS public.complete_production_order(uuid, numeric);

CREATE OR REPLACE FUNCTION public.complete_production_order(p_order_id uuid, p_qty_produced numeric, p_altura numeric DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.register_production(
  p_clinic_id uuid,
  p_product_item_id uuid,
  p_qty numeric,
  p_notes text DEFAULT NULL,
  p_altura numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_res jsonb;
BEGIN
  IF NOT has_clinic_access(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF p_product_item_id IS NULL OR COALESCE(p_qty, 0) <= 0 THEN RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input'); END IF;

  INSERT INTO public.production_orders (clinic_id, product_item_id, qty_planned, status, notes, altura, created_by)
  VALUES (p_clinic_id, p_product_item_id, p_qty, 'planejada', p_notes, p_altura, auth.uid())
  RETURNING id INTO v_id;

  v_res := public.complete_production_order(v_id, p_qty, p_altura);
  RETURN COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('order_id', v_id);
END;
$$;
