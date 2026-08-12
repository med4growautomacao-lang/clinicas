-- 20260408133207_add_clinic_name_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS clinic_name text;

-- Popula dados existentes
UPDATE leads l
SET clinic_name = c.name
FROM clinics c
WHERE l.clinic_id = c.id;

-- Trigger para manter sincronizado
CREATE OR REPLACE FUNCTION sync_clinic_name_to_leads()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE leads SET clinic_name = NEW.name WHERE clinic_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clinic_name_leads ON clinics;
CREATE TRIGGER trg_sync_clinic_name_leads
  AFTER UPDATE OF name ON clinics
  FOR EACH ROW EXECUTE FUNCTION sync_clinic_name_to_leads();

-- Trigger para preencher clinic_name ao inserir novo lead
CREATE OR REPLACE FUNCTION fill_clinic_name_on_lead()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clinic_name IS NULL THEN
    SELECT name INTO NEW.clinic_name FROM clinics WHERE id = NEW.clinic_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_clinic_name_lead ON leads;
CREATE TRIGGER trg_fill_clinic_name_lead
  BEFORE INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION fill_clinic_name_on_lead();
