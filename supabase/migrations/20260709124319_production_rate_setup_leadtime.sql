-- 20260709124319_production_rate_setup_leadtime
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS taxa_producao_m2_hora numeric;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS tempo_setup_horas numeric NOT NULL DEFAULT 0;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS horas_uteis_producao_dia numeric NOT NULL DEFAULT 8;

CREATE OR REPLACE FUNCTION public.fn_estimate_production_due_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        inventory_items%ROWTYPE;
  v_base        uuid;
  v_em_andamento boolean;
  v_area        numeric;
  v_horas       numeric;
  v_horasdia    numeric;
  v_dias        int;
BEGIN
  IF NEW.due_date IS NOT NULL OR NEW.product_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = NEW.product_item_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COALESCE(base_product_id, id) INTO v_base FROM public.products WHERE id = v_item.product_id;
  IF v_base IS NULL THEN v_base := v_item.product_id; END IF;

  v_em_andamento := v_base IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.production_orders po2
    JOIN public.inventory_items ii2 ON ii2.id = po2.product_item_id
    JOIN public.products p2 ON p2.id = ii2.product_id
    WHERE po2.status = 'em_producao'
      AND po2.clinic_id = NEW.clinic_id
      AND COALESCE(p2.base_product_id, p2.id) = v_base
  );

  IF COALESCE(v_item.taxa_producao_m2_hora, 0) > 0 THEN
    v_area  := NEW.qty_planned * COALESCE(NULLIF(v_item.altura, 0), 1);
    v_horas := (CASE WHEN v_em_andamento THEN 0 ELSE COALESCE(v_item.tempo_setup_horas, 0) END) + v_area / v_item.taxa_producao_m2_hora;
    SELECT COALESCE(horas_uteis_producao_dia, 8) INTO v_horasdia FROM public.clinics WHERE id = NEW.clinic_id;
    v_dias := GREATEST(1, CEIL(v_horas / NULLIF(v_horasdia, 0)));
  ELSE
    v_dias := COALESCE(v_item.lead_time_producao, 0);
  END IF;

  NEW.due_date := CURRENT_DATE + v_dias;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estimate_production_due_date ON public.production_orders;
CREATE TRIGGER trg_estimate_production_due_date
  BEFORE INSERT ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_estimate_production_due_date();
