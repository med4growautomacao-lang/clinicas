-- 20260409201931_sync_clinic_name_whatsapp_instances
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Backfill dos nulls
UPDATE whatsapp_instances wi
SET clinic_name = c.name
FROM clinics c
WHERE c.id = wi.clinic_id
  AND wi.clinic_name IS NULL;

-- 2. Função que sincroniza clinic_name ao inserir/atualizar instância
CREATE OR REPLACE FUNCTION sync_whatsapp_instance_clinic_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.clinic_name IS NULL THEN
    SELECT name INTO NEW.clinic_name FROM clinics WHERE id = NEW.clinic_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Trigger BEFORE INSERT OR UPDATE
DROP TRIGGER IF EXISTS trg_sync_whatsapp_clinic_name ON whatsapp_instances;
CREATE TRIGGER trg_sync_whatsapp_clinic_name
  BEFORE INSERT OR UPDATE ON whatsapp_instances
  FOR EACH ROW
  EXECUTE FUNCTION sync_whatsapp_instance_clinic_name();

-- 4. Trigger para quando o nome da clínica mudar na tabela clinics
CREATE OR REPLACE FUNCTION propagate_clinic_name_to_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE whatsapp_instances SET clinic_name = NEW.name WHERE clinic_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_clinic_name_whatsapp ON clinics;
CREATE TRIGGER trg_propagate_clinic_name_whatsapp
  AFTER UPDATE ON clinics
  FOR EACH ROW
  EXECUTE FUNCTION propagate_clinic_name_to_whatsapp();
