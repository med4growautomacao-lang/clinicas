-- 20260709142856_fix_vw_inventory_available_frozen_columns
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP VIEW IF EXISTS public.vw_inventory_available;

CREATE VIEW public.vw_inventory_available
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

GRANT SELECT ON public.vw_inventory_available TO anon, authenticated;
