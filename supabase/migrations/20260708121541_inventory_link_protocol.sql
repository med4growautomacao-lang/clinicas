-- 20260708121541_inventory_link_protocol
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS protocol_id uuid REFERENCES public.protocols(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_items_protocol_idx
  ON public.inventory_items (protocol_id) WHERE protocol_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_clinic_product_uq
  ON public.inventory_items (clinic_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_clinic_protocol_uq
  ON public.inventory_items (clinic_id, protocol_id) WHERE protocol_id IS NOT NULL;
