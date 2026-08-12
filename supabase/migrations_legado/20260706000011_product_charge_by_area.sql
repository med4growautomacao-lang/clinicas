-- Produto cobrado por m² (área = comprimento x altura). Quando true, o orçamento mostra um
-- campo de altura ao lado da quantidade e o subtotal = quantidade x altura x valor.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS charge_by_area boolean NOT NULL DEFAULT false;
