-- 20260512033146_phase1_link_conversions_to_transactions
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1.1 Link estrutural
ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS financial_transaction_id uuid REFERENCES financial_transactions(id) ON DELETE SET NULL;

-- 1.2 Limpa duplicata explícita da Metaltres (mantém o registro mais antigo)
DELETE FROM conversions a
USING conversions b
WHERE a.lead_id = b.lead_id
  AND a.clinic_id = b.clinic_id
  AND a.value = b.value
  AND a.converted_at::date = b.converted_at::date
  AND a.id > b.id;

-- 1.3 Backfill: liga conversões antigas às transactions correspondentes
UPDATE conversions c
SET financial_transaction_id = ft.id
FROM (
  SELECT DISTINCT ON (clinic_id, amount, date) id, clinic_id, amount, date
  FROM financial_transactions
  WHERE type = 'receita'
  ORDER BY clinic_id, amount, date, created_at ASC
) ft
WHERE c.financial_transaction_id IS NULL
  AND ft.clinic_id = c.clinic_id
  AND ft.amount = c.value::numeric
  AND ft.date = c.converted_at::date;

-- 1.4 Constraint anti-duplicação
DROP INDEX IF EXISTS conversions_lead_tx_unique;
CREATE UNIQUE INDEX conversions_lead_tx_unique
  ON conversions(lead_id, financial_transaction_id)
  WHERE financial_transaction_id IS NOT NULL;

-- 1.5 Index unique em financial_transactions por appointment
DROP INDEX IF EXISTS financial_tx_unique_per_apt;
CREATE UNIQUE INDEX financial_tx_unique_per_apt
  ON financial_transactions(appointment_id)
  WHERE appointment_id IS NOT NULL;
