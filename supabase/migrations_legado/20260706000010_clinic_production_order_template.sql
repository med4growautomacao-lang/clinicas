-- Modelo padrão da Ordem de Produção por clínica (documento voltado à produção/fábrica).
-- Campos: responsavel, prazo, observacoes, show_prices (bool), format ('imagem'|'pdf').
-- Configurável em Configurações › Dados da Clínica › "Ordem de Produção".
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS production_order_template jsonb NOT NULL DEFAULT '{}'::jsonb;
