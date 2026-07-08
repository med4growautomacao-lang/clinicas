-- Responsavel pela movimentacao de estoque (quem fez a entrada/saida/ajuste).
-- Texto livre (o operador de chao de fabrica nem sempre e usuario do sistema).
ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS responsavel text;
