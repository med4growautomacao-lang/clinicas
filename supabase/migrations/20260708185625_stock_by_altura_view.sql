-- 20260708185625_stock_by_altura_view
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE VIEW public.vw_inventory_stock_by_altura
WITH (security_invoker = true) AS
SELECT clinic_id, item_id, altura,
       SUM(CASE WHEN type = 'entrada' THEN qty ELSE -qty END)::numeric AS qty
FROM public.inventory_movements
WHERE altura IS NOT NULL
GROUP BY clinic_id, item_id, altura;

GRANT SELECT ON public.vw_inventory_stock_by_altura TO anon, authenticated;
