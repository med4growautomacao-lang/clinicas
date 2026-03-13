-- Adiciona a coluna name na tabela ai_config
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS name text;

-- Opcional: define um valor padrao ou inicializa para as clinicas que ja tem, se necessario
-- UPDATE ai_config SET name = 'Assistente IA' WHERE name IS NULL;
