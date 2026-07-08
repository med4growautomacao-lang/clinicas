-- Registro rapido de producao "por tela produzida": cria uma OP concluida e baixa a
-- materia-prima pela ficha tecnica, num passo so (atomico). Reusa complete_production_order.
-- Serve para o chao de fabrica lancar "produzi X m2 da tela Y" sem montar OP planejada.

CREATE OR REPLACE FUNCTION public.register_production(
  p_clinic_id uuid,
  p_product_item_id uuid,
  p_qty numeric,
  p_notes text DEFAULT NULL
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
  IF NOT has_clinic_access(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_product_item_id IS NULL OR COALESCE(p_qty, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_input');
  END IF;

  INSERT INTO public.production_orders (clinic_id, product_item_id, qty_planned, status, notes, created_by)
  VALUES (p_clinic_id, p_product_item_id, p_qty, 'planejada', p_notes, auth.uid())
  RETURNING id INTO v_id;

  v_res := public.complete_production_order(v_id, p_qty);
  RETURN COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('order_id', v_id);
END;
$$;
