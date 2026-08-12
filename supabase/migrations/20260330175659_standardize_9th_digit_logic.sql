-- 20260330175659_standardize_9th_digit_logic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Atualizar a função de sanitização de Leads para MANTER e ADICIONAR o 9º dígito
CREATE OR REPLACE FUNCTION public.sanitize_lead_phone_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.phone IS NOT NULL THEN
    -- Remove tudo que não é número
    NEW.phone := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
    
    -- Se tiver 12 dígitos e começar com 55 (ex: 551188887777), adiciona o 9 (ex: 5511988887777)
    -- Isso padroniza todos os celulares brasileiros para o formato de 13 dígitos.
    IF length(NEW.phone) = 12 AND left(NEW.phone, 2) = '55' THEN
       NEW.phone := left(NEW.phone, 4) || '9' || right(NEW.phone, 8);
    END IF;

    IF NEW.phone = '' THEN
      NEW.phone := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2. Atualizar a função de sanitização de Instâncias WhatsApp para MANTER e ADICIONAR o 9º dígito
CREATE OR REPLACE FUNCTION public.sanitize_whatsapp_phone_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.phone_number IS NOT NULL THEN
    -- Remove tudo que não é número
    NEW.phone_number := regexp_replace(NEW.phone_number, '[^0-9]', '', 'g');
    
    -- Se tiver 12 dígitos e começar com 55, adiciona o 9
    IF length(NEW.phone_number) = 12 AND left(NEW.phone_number, 2) = '55' THEN
       NEW.phone_number := left(NEW.phone_number, 4) || '9' || right(NEW.phone_number, 8);
    END IF;

    IF NEW.phone_number = '' THEN
      NEW.phone_number := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Atualizar todos os registros existentes na tabela de Leads
UPDATE public.leads 
SET phone = left(phone, 4) || '9' || right(phone, 8)
WHERE length(phone) = 12 AND left(phone, 2) = '55';

-- 4. Atualizar todos os registros existentes na tabela de Instâncias WhatsApp
UPDATE public.whatsapp_instances
SET phone_number = left(phone_number, 4) || '9' || right(phone_number, 8)
WHERE length(phone_number) = 12 AND left(phone_number, 2) = '55';
