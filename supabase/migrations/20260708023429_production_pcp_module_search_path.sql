-- 20260708023429_production_pcp_module_search_path
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Higiene: fixa search_path das duas trigger functions do modulo (advisor function_search_path_mutable).
CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.inventory_items
     SET current_qty = current_qty + (CASE WHEN NEW.type = 'entrada' THEN NEW.qty ELSE -NEW.qty END)
   WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_clinic_sequential_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.number IS NULL OR NEW.number = 0 THEN
    IF TG_TABLE_NAME = 'production_orders' THEN
      SELECT COALESCE(MAX(number), 0) + 1 INTO NEW.number FROM public.production_orders WHERE clinic_id = NEW.clinic_id;
    ELSIF TG_TABLE_NAME = 'maintenance_orders' THEN
      SELECT COALESCE(MAX(number), 0) + 1 INTO NEW.number FROM public.maintenance_orders WHERE clinic_id = NEW.clinic_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
