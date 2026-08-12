-- 20260421225055_sync_google_mcc_to_clinics
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Adiciona colunas nas clinics
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS google_ad_mcc_id text,
  ADD COLUMN IF NOT EXISTS google_ad_mcc_token text;

-- 2. Popula clinics existentes a partir da organização
UPDATE clinics c
SET
  google_ad_mcc_id    = o.google_ad_mcc_id,
  google_ad_mcc_token = o.google_ad_mcc_token
FROM organizations o
WHERE c.organization_id = o.id
  AND (o.google_ad_mcc_id IS NOT NULL OR o.google_ad_mcc_token IS NOT NULL);

-- 3. Trigger: nova clínica herda do org
CREATE OR REPLACE FUNCTION fn_clinic_inherit_google_mcc()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    SELECT google_ad_mcc_id, google_ad_mcc_token
    INTO NEW.google_ad_mcc_id, NEW.google_ad_mcc_token
    FROM organizations
    WHERE id = NEW.organization_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clinic_inherit_google_mcc ON clinics;
CREATE TRIGGER trg_clinic_inherit_google_mcc
  BEFORE INSERT ON clinics
  FOR EACH ROW EXECUTE FUNCTION fn_clinic_inherit_google_mcc();

-- 4. Trigger: quando org atualiza MCC, propaga para todas as clínicas
CREATE OR REPLACE FUNCTION fn_org_sync_google_mcc()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.google_ad_mcc_id IS DISTINCT FROM OLD.google_ad_mcc_id
     OR NEW.google_ad_mcc_token IS DISTINCT FROM OLD.google_ad_mcc_token THEN
    UPDATE clinics
    SET
      google_ad_mcc_id    = NEW.google_ad_mcc_id,
      google_ad_mcc_token = NEW.google_ad_mcc_token
    WHERE organization_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_org_sync_google_mcc ON organizations;
CREATE TRIGGER trg_org_sync_google_mcc
  AFTER UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION fn_org_sync_google_mcc();
