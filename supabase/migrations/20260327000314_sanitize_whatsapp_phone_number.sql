-- 20260327000314_sanitize_whatsapp_phone_number
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Create a function to sanitize phone_number, stripping all whitespace and control characters
CREATE OR REPLACE FUNCTION sanitize_whatsapp_phone_number()
RETURNS TRIGGER AS $$
BEGIN
  -- Strip \r, \n, spaces, tabs, and any non-digit characters from phone_number
  IF NEW.phone_number IS NOT NULL THEN
    NEW.phone_number := regexp_replace(NEW.phone_number, '[^0-9+]', '', 'g');
    -- If the result is empty after sanitization, set to null
    IF NEW.phone_number = '' THEN
      NEW.phone_number := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a BEFORE INSERT OR UPDATE trigger to automatically sanitize
DROP TRIGGER IF EXISTS tr_sanitize_whatsapp_phone ON whatsapp_instances;
CREATE TRIGGER tr_sanitize_whatsapp_phone
  BEFORE INSERT OR UPDATE ON whatsapp_instances
  FOR EACH ROW
  EXECUTE FUNCTION sanitize_whatsapp_phone_number();

-- Also clean existing data right now
UPDATE whatsapp_instances 
SET phone_number = regexp_replace(phone_number, '[^0-9+]', '', 'g')
WHERE phone_number IS NOT NULL 
  AND phone_number <> regexp_replace(phone_number, '[^0-9+]', '', 'g');
