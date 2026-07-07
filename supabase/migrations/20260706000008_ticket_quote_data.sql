-- Snapshot estruturado do orçamento por ticket, para reabrir o modal do Kanban com os itens
-- preenchidos (produtos/protocolos, quantidades, desconto/frete por linha, formato, textos).
-- Complementa o resumo em texto (tickets.notes) e o valor total (leads.estimated_value).
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS quote_data jsonb;
