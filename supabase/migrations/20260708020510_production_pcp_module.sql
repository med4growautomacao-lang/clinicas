-- 20260708020510_production_pcp_module
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Modulo Estoque + PCP + Manutencao (clientes WakeDesk, clinics.category='outro').

CREATE OR REPLACE FUNCTION public.has_clinic_access(p_clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    ((p_clinic_id IN (SELECT clinic_id FROM clinic_users WHERE id = auth.uid())) AND is_clinic_active(p_clinic_id))
    OR (p_clinic_id IN (SELECT c.id FROM clinics c JOIN org_users ou ON ou.organization_id = c.organization_id WHERE ou.user_id = auth.uid()))
    OR is_clinic_admin(p_clinic_id)
  );
$$;

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'materia_prima' CHECK (kind IN ('materia_prima','produto_acabado','insumo')),
  name        text NOT NULL,
  sku         text,
  category    text,
  unit        text NOT NULL DEFAULT 'un',
  current_qty numeric NOT NULL DEFAULT 0,
  min_qty     numeric NOT NULL DEFAULT 0,
  unit_cost   numeric NOT NULL DEFAULT 0,
  product_id  uuid REFERENCES public.products(id) ON DELETE SET NULL,
  location    text,
  is_active   boolean NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_items_clinic_idx ON public.inventory_items (clinic_id);
CREATE INDEX IF NOT EXISTS inventory_items_clinic_kind_idx ON public.inventory_items (clinic_id, kind);
CREATE INDEX IF NOT EXISTS inventory_items_product_idx ON public.inventory_items (product_id) WHERE product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.product_bom (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  product_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  material_item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  qty_per_unit    numeric NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_item_id, material_item_id)
);
CREATE INDEX IF NOT EXISTS product_bom_clinic_idx ON public.product_bom (clinic_id);
CREATE INDEX IF NOT EXISTS product_bom_product_idx ON public.product_bom (product_item_id);

CREATE TABLE IF NOT EXISTS public.production_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  number          integer NOT NULL DEFAULT 0,
  product_item_id uuid REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  product_label   text,
  qty_planned     numeric NOT NULL DEFAULT 0,
  qty_produced    numeric NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'planejada' CHECK (status IN ('planejada','em_producao','concluida','cancelada')),
  priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta')),
  due_date        date,
  started_at      timestamptz,
  finished_at     timestamptz,
  ticket_id       uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  lead_id         uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  client_name     text,
  notes           text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, number)
);
CREATE INDEX IF NOT EXISTS production_orders_clinic_idx ON public.production_orders (clinic_id);
CREATE INDEX IF NOT EXISTS production_orders_status_idx ON public.production_orders (clinic_id, status);

CREATE TABLE IF NOT EXISTS public.equipment (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name       text NOT NULL,
  code       text,
  location   text,
  status     text NOT NULL DEFAULT 'operando' CHECK (status IN ('operando','parada','manutencao')),
  notes      text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS equipment_clinic_idx ON public.equipment (clinic_id);

CREATE TABLE IF NOT EXISTS public.maintenance_orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  number         integer NOT NULL DEFAULT 0,
  equipment_id   uuid REFERENCES public.equipment(id) ON DELETE SET NULL,
  type           text NOT NULL DEFAULT 'corretiva' CHECK (type IN ('preventiva','corretiva','preditiva')),
  status         text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_andamento','concluida','cancelada')),
  priority       text NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta')),
  scheduled_date date,
  completed_at   timestamptz,
  cost           numeric NOT NULL DEFAULT 0,
  technician     text,
  description    text,
  notes          text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, number)
);
CREATE INDEX IF NOT EXISTS maintenance_orders_clinic_idx ON public.maintenance_orders (clinic_id);
CREATE INDEX IF NOT EXISTS maintenance_orders_status_idx ON public.maintenance_orders (clinic_id, status);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  item_id             uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  type                text NOT NULL CHECK (type IN ('entrada','saida')),
  qty                 numeric NOT NULL CHECK (qty > 0),
  unit_cost           numeric,
  reason              text,
  production_order_id uuid REFERENCES public.production_orders(id) ON DELETE SET NULL,
  maintenance_order_id uuid REFERENCES public.maintenance_orders(id) ON DELETE SET NULL,
  notes               text,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_movements_clinic_idx ON public.inventory_movements (clinic_id);
CREATE INDEX IF NOT EXISTS inventory_movements_item_idx ON public.inventory_movements (item_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.apply_inventory_movement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.inventory_items
     SET current_qty = current_qty + (CASE WHEN NEW.type = 'entrada' THEN NEW.qty ELSE -NEW.qty END)
   WHERE id = NEW.item_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_inventory_movement ON public.inventory_movements;
CREATE TRIGGER trg_apply_inventory_movement
  AFTER INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_inventory_movement();

CREATE OR REPLACE FUNCTION public.set_clinic_sequential_number()
RETURNS trigger
LANGUAGE plpgsql
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

DROP TRIGGER IF EXISTS trg_number_production_orders ON public.production_orders;
CREATE TRIGGER trg_number_production_orders
  BEFORE INSERT ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_sequential_number();

DROP TRIGGER IF EXISTS trg_number_maintenance_orders ON public.maintenance_orders;
CREATE TRIGGER trg_number_maintenance_orders
  BEFORE INSERT ON public.maintenance_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_sequential_number();

CREATE OR REPLACE FUNCTION public.complete_production_order(p_order_id uuid, p_qty_produced numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  public.production_orders%ROWTYPE;
  v_qty    numeric := GREATEST(COALESCE(p_qty_produced, 0), 0);
  v_bom    record;
BEGIN
  SELECT * INTO v_order FROM public.production_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'order_not_found');
  END IF;
  IF NOT has_clinic_access(v_order.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF v_order.status = 'concluida' THEN
    RETURN jsonb_build_object('success', true, 'already_done', true);
  END IF;
  IF v_order.status = 'cancelada' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'order_cancelled');
  END IF;

  UPDATE public.production_orders
     SET qty_produced = v_qty, status = 'concluida', finished_at = now(),
         started_at = COALESCE(started_at, now())
   WHERE id = p_order_id;

  IF v_order.product_item_id IS NOT NULL AND v_qty > 0 THEN
    FOR v_bom IN
      SELECT material_item_id, qty_per_unit FROM public.product_bom
       WHERE product_item_id = v_order.product_item_id AND qty_per_unit > 0
    LOOP
      INSERT INTO public.inventory_movements (clinic_id, item_id, type, qty, reason, production_order_id, created_by)
      VALUES (v_order.clinic_id, v_bom.material_item_id, 'saida', v_bom.qty_per_unit * v_qty, 'consumo_producao', p_order_id, auth.uid());
    END LOOP;

    INSERT INTO public.inventory_movements (clinic_id, item_id, type, qty, reason, production_order_id, created_by)
    VALUES (v_order.clinic_id, v_order.product_item_id, 'entrada', v_qty, 'producao', p_order_id, auth.uid());
  END IF;

  RETURN jsonb_build_object('success', true, 'order_id', p_order_id);
END;
$$;

ALTER TABLE public.inventory_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_bom        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_orders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_items_access ON public.inventory_items;
CREATE POLICY inventory_items_access ON public.inventory_items AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));

DROP POLICY IF EXISTS inventory_movements_access ON public.inventory_movements;
CREATE POLICY inventory_movements_access ON public.inventory_movements AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));

DROP POLICY IF EXISTS product_bom_access ON public.product_bom;
CREATE POLICY product_bom_access ON public.product_bom AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));

DROP POLICY IF EXISTS production_orders_access ON public.production_orders;
CREATE POLICY production_orders_access ON public.production_orders AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));

DROP POLICY IF EXISTS equipment_access ON public.equipment;
CREATE POLICY equipment_access ON public.equipment AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));

DROP POLICY IF EXISTS maintenance_orders_access ON public.maintenance_orders;
CREATE POLICY maintenance_orders_access ON public.maintenance_orders AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_items; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory_movements; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.production_orders; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.equipment; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance_orders; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
