-- 20260327183445_fix_brazilian_phone_9th_digit
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Update sanitize_whatsapp_phone_number function (used by whatsapp_instances)
CREATE OR REPLACE FUNCTION public.sanitize_whatsapp_phone_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Strip non-digit characters
  IF NEW.phone_number IS NOT NULL THEN
    NEW.phone_number := regexp_replace(NEW.phone_number, '[^0-9]', '', 'g');
    
    -- Adjust for Brazilian 9th digit: if 13 digits starting with 55, remove the 5th character (the extra 9)
    -- Example: 55 35 9 9822 8965 (13 chars) -> 55 35 9822 8965 (12 chars)
    IF length(NEW.phone_number) = 13 AND left(NEW.phone_number, 2) = '55' THEN
       NEW.phone_number := left(NEW.phone_number, 4) || right(NEW.phone_number, 8);
    END IF;

    IF NEW.phone_number = '' THEN
      NEW.phone_number := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Create lead-specific sanitization function
CREATE OR REPLACE FUNCTION public.sanitize_lead_phone_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    NEW.phone := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
    
    -- Adjust for Brazilian 9th digit: if 13 digits starting with 55, remove the 5th character
    IF length(NEW.phone) = 13 AND left(NEW.phone, 2) = '55' THEN
       NEW.phone := left(NEW.phone, 4) || right(NEW.phone, 8);
    END IF;

    IF NEW.phone = '' THEN
      NEW.phone := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Add trigger to leads table
DROP TRIGGER IF EXISTS tr_sanitize_lead_phone ON public.leads;
CREATE TRIGGER tr_sanitize_lead_phone
BEFORE INSERT OR UPDATE OF phone ON public.leads
FOR EACH ROW EXECUTE FUNCTION sanitize_lead_phone_number();

-- 4. Normalize existing data (this will trigger the functions and sync to ai_config)
UPDATE public.whatsapp_instances SET phone_number = phone_number;
UPDATE public.leads SET phone = phone;
