-- Saldo por (item, altura) para exibir a altura como "subproduto" dinamico na lista de estoque:
-- aparece quando ha saldo > 0, some quando zera. security_invoker=true => respeita a RLS de
-- inventory_movements (isolamento por clinica), evitando o alerta security_definer_view.
CREATE OR REPLACE VIEW public.vw_inventory_stock_by_altura
WITH (security_invoker = true) AS
SELECT clinic_id, item_id, altura,
       SUM(CASE WHEN type = 'entrada' THEN qty ELSE -qty END)::numeric AS qty
FROM public.inventory_movements
WHERE altura IS NOT NULL
GROUP BY clinic_id, item_id, altura;

GRANT SELECT ON public.vw_inventory_stock_by_altura TO anon, authenticated;
