-- BUG: vw_inventory_available foi criada com `SELECT ii.*` ANTES de existirem as colunas
-- taxa_producao_m2_hora e tempo_setup_horas (migration ...040). No Postgres o `*` é expandido e
-- CONGELADO na criação da view, então essas duas colunas nunca apareceram na view. A tela lê o
-- estoque pela view -> os valores eram gravados na tabela mas voltavam vazios ao reabrir (parecia
-- "não salvou"), e pior: o form recarregava 0 e o próximo save podia zerar o valor real.
-- FIX: recriar a view para o `ii.*` re-expandir com as colunas atuais.
--
-- ⚠️ IMPORTANTE: sempre que adicionar coluna em inventory_items, RECRIAR esta view (DROP+CREATE),
-- senão a coluna nova não aparece aqui (mesmo bug). CREATE OR REPLACE não resolve porque o `ii.*`
-- passa a inserir colunas no meio, mudando a ordem de saída (proibido em REPLACE) — por isso DROP.

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
