-- Configuração do Orçamento por clínica: quais fontes de item o modal de orçamento oferece.
--   quote_use_products   -> lista o catálogo de Produtos
--   quote_use_protocols  -> lista os Protocolos de atendimento
-- Configurável em Configurações › Dados da Clínica › "Configuração do Orçamento".
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS quote_use_products  boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS quote_use_protocols boolean NOT NULL DEFAULT true;
