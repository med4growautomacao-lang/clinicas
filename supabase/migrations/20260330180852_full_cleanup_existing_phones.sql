-- 20260330180852_full_cleanup_existing_phones
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Limpar leads: remove 0, adiciona 55 se faltar, adiciona 9 se faltar
UPDATE public.leads
SET phone = CASE 
    -- Se começar com 0, remove o 0
    WHEN left(phone, 1) = '0' THEN regexp_replace(substr(phone, 2), '[^0-9]', '', 'g')
    ELSE regexp_replace(phone, '[^0-9]', '', 'g')
    END;

-- 2. Adiciona 55 se tiver 10 ou 11 dígitos
UPDATE public.leads
SET phone = '55' || phone
WHERE length(phone) IN (10, 11);

-- 3. Adiciona o 9 se tiver 12 dígitos e começar com 55
UPDATE public.leads
SET phone = left(phone, 4) || '9' || right(phone, 8)
WHERE length(phone) = 12 AND left(phone, 2) = '55';

-- Repetir para instâncias
UPDATE public.whatsapp_instances
SET phone_number = CASE 
    WHEN left(phone_number, 1) = '0' THEN regexp_replace(substr(phone_number, 2), '[^0-9]', '', 'g')
    ELSE regexp_replace(phone_number, '[^0-9]', '', 'g')
    END;

UPDATE public.whatsapp_instances
SET phone_number = '55' || phone_number
WHERE length(phone_number) IN (10, 11);

UPDATE public.whatsapp_instances
SET phone_number = left(phone_number, 4) || '9' || right(phone_number, 8)
WHERE length(phone_number) = 12 AND left(phone_number, 2) = '55';
