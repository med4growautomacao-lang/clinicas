-- Modelo padrão do orçamento por clínica: pré-preenche o modal do Kanban (etapa 2) e o
-- documento formal. Campos: saudacao (aceita {nome}), rodape, validade, pagamento,
-- include_specs (bool), format ('texto'|'imagem'|'pdf').
-- Configurável em Configurações › Dados da Clínica › Configuração do Orçamento › "Configurar modelo".
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS quote_template jsonb NOT NULL DEFAULT '{}'::jsonb;
