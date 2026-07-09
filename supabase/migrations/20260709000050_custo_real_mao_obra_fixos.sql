-- Custo real de produção = custo de material (ficha técnica) + mão de obra + custos fixos.
-- Mão de obra e custos fixos são R$/hora, cadastrados 1x pela clínica (Configurações), e multiplicam
-- pelo tempo de produção CORRIDO do SKU (altura/taxa_producao_m2_hora — mesma conta usada no prazo
-- da OP). O tempo de SETUP fica de fora do rateio por unidade (decisão do usuário: setup é custo de
-- lote, ratear por metro distorceria pedidos pequenos/grandes sem assumir um tamanho de lote fixo).
-- Cálculo é só informativo no frontend (não grava em inventory_items.unit_cost automaticamente).

ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS custo_mao_obra_hora numeric NOT NULL DEFAULT 0;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS custo_fixo_hora numeric NOT NULL DEFAULT 0;
