-- Interliga o item de estoque "produto acabado" ao catalogo cadastrado em Dados da Clinica:
-- alem de products (product_id, ja existente), permite vincular a protocols (protocol_id).
-- Um item de estoque referencia no maximo 1 produto OU 1 protocolo (mutuamente exclusivo na UI).

ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS protocol_id uuid REFERENCES public.protocols(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inventory_items_protocol_idx
  ON public.inventory_items (protocol_id) WHERE protocol_id IS NOT NULL;

-- No maximo 1 item de estoque por produto/protocolo do catalogo (por clinica) -> resolucao 1:1
-- na geracao de OP a partir do orcamento.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_clinic_product_uq
  ON public.inventory_items (clinic_id, product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_clinic_protocol_uq
  ON public.inventory_items (clinic_id, protocol_id) WHERE protocol_id IS NOT NULL;
