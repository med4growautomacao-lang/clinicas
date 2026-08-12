-- 20260512183228_tickets_lifecycle_constraints
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Mudar FK tickets.lead_id de CASCADE para SET NULL
ALTER TABLE tickets
  DROP CONSTRAINT tickets_lead_id_fkey,
  ADD CONSTRAINT tickets_lead_id_fkey
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

-- 1a. lead_id agora pode ser NULL (era NOT NULL)
ALTER TABLE tickets ALTER COLUMN lead_id DROP NOT NULL;

-- 2. Adicionar ticket_id em conversions
ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL;

-- 3. UNIQUE: 1 appointment ativo por ticket (exclui cancelado/faltou)
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_active_per_ticket
  ON appointments (ticket_id)
  WHERE ticket_id IS NOT NULL
    AND status NOT IN ('cancelado', 'faltou');

-- 4. UNIQUE: 1 conversão por ticket
CREATE UNIQUE INDEX IF NOT EXISTS conversions_one_per_ticket
  ON conversions (ticket_id)
  WHERE ticket_id IS NOT NULL;
