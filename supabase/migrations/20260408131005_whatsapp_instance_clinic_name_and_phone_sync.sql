-- 20260408131005_whatsapp_instance_clinic_name_and_phone_sync
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Adiciona coluna clinic_name em whatsapp_instances
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS clinic_name text;

-- 2. Popula clinic_name com dados existentes
UPDATE whatsapp_instances wi
SET clinic_name = c.name
FROM clinics c
WHERE wi.clinic_id = c.id;

-- 3. Trigger: mantém clinic_name sincronizado quando clinics.name muda
CREATE OR REPLACE FUNCTION sync_clinic_name_to_instance()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE whatsapp_instances
  SET clinic_name = NEW.name
  WHERE clinic_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clinic_name ON clinics;
CREATE TRIGGER trg_sync_clinic_name
  AFTER UPDATE OF name ON clinics
  FOR EACH ROW EXECUTE FUNCTION sync_clinic_name_to_instance();

-- 4. Trigger: sincroniza phone_number -> clinics.phone quando whatsapp conecta
CREATE OR REPLACE FUNCTION sync_phone_to_clinic()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phone_number IS NOT NULL AND NEW.phone_number IS DISTINCT FROM OLD.phone_number THEN
    UPDATE clinics
    SET phone = NEW.phone_number
    WHERE id = NEW.clinic_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_phone_to_clinic ON whatsapp_instances;
CREATE TRIGGER trg_sync_phone_to_clinic
  AFTER UPDATE OF phone_number ON whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION sync_phone_to_clinic();
