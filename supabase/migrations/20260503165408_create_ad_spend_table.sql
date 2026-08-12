-- 20260503165408_create_ad_spend_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('meta_ads', 'google_ads')),
  date date NOT NULL,
  amount_spent numeric(10,2) NOT NULL DEFAULT 0,
  impressions integer DEFAULT 0,
  clicks integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE (clinic_id, platform, date)
);

ALTER TABLE ad_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ad_spend_access"
  ON ad_spend FOR ALL
  USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users WHERE id = auth.uid()
      UNION
      SELECT c.id FROM clinics c
        JOIN org_users ou ON ou.organization_id = c.organization_id
        WHERE ou.user_id = auth.uid()
    )
  );
