-- 20260709082325_flatten_tela_skus_por_altura
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Passo 0 do motor de produção (WakeDesk): "flatten" — cada (produto × altura padrão) vira um
-- SKU próprio (produto + item de estoque), em METRO LINEAR, começando em 0. Alturas padrão de
-- rolo: 1 / 1,2 / 1,5 / 1,8 / 2,0. Os produtos-base de teste são aposentados (is_active=false).
-- Idempotente no replay: a origem é filtrada por is_active=true AND altura IS NULL (bases),
-- que fica vazia depois da 1ª execução.

-- ============ colunas de cadastro (aditivas, globais) ============
ALTER TABLE public.products        ADD COLUMN IF NOT EXISTS altura numeric;
ALTER TABLE public.products        ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'padrao';
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS altura numeric;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'padrao';
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS lote_minimo numeric;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS lead_time_producao integer;

DO $$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_tipo_chk CHECK (tipo IN ('padrao','sob_medida'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_tipo_chk CHECK (tipo IN ('padrao','sob_medida'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ cria os 40 SKUs de produto (catálogo de venda) ============
-- unit_price/charge_by_area copiados do base; altura fixa; preço segue por m² (área = comprimento × altura).
INSERT INTO public.products (clinic_id, name, description, unit, unit_price, attributes, is_active, charge_by_area, color, position, altura, tipo)
SELECT p.clinic_id,
       p.name || ' — ' || a.lbl || 'm',
       p.description, p.unit, p.unit_price, p.attributes, true, p.charge_by_area, p.color, p.position,
       a.alt, 'padrao'
FROM public.products p
CROSS JOIN (VALUES (1.0::numeric,'1'), (1.2,'1,2'), (1.5,'1,5'), (1.8,'1,8'), (2.0,'2')) AS a(alt, lbl)
WHERE p.clinic_id = '43575057-f20a-40a3-8805-200384d0b867'
  AND p.is_active = true
  AND p.altura IS NULL;

-- ============ cria os 40 itens de estoque (SKU físico), em metro linear, saldo 0 ============
INSERT INTO public.inventory_items (clinic_id, kind, name, unit, current_qty, min_qty, unit_cost, product_id, is_active, altura, tipo)
SELECT p.clinic_id, 'produto_acabado', p.name, 'm', 0, 0, 0, p.id, true, p.altura, 'padrao'
FROM public.products p
WHERE p.clinic_id = '43575057-f20a-40a3-8805-200384d0b867'
  AND p.altura IS NOT NULL
  AND p.tipo = 'padrao'
  AND NOT EXISTS (SELECT 1 FROM public.inventory_items ii WHERE ii.product_id = p.id);

-- ============ aposenta os 8 produtos-base de teste + seus itens antigos ============
UPDATE public.inventory_items SET is_active = false
WHERE clinic_id = '43575057-f20a-40a3-8805-200384d0b867'
  AND product_id IN (SELECT id FROM public.products WHERE clinic_id = '43575057-f20a-40a3-8805-200384d0b867' AND altura IS NULL);

UPDATE public.products SET is_active = false
WHERE clinic_id = '43575057-f20a-40a3-8805-200384d0b867' AND altura IS NULL;
