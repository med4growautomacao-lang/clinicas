-- 20260503172632_create_protocols_and_update_financial
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Tabela de protocolos por clínica
CREATE TABLE protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price numeric(10,2),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE protocols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "protocols_access"
  ON protocols FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE id = auth.uid()
      UNION
      SELECT c.id FROM clinics c
        JOIN org_users ou ON ou.organization_id = c.organization_id
        WHERE ou.user_id = auth.uid()
    )
  );

-- Adiciona protocol_ids e description em financial_transactions
ALTER TABLE financial_transactions
  ADD COLUMN IF NOT EXISTS protocol_ids uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes text;

-- Adiciona protocol_ids em conversions
ALTER TABLE conversions
  ADD COLUMN IF NOT EXISTS protocol_ids uuid[] DEFAULT '{}';
