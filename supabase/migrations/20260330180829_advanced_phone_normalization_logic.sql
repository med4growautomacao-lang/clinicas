-- 20260330180829_advanced_phone_normalization_logic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Função de sanitização de Leads com NORMALIZAÇÃO AGRESSIVA
CREATE OR REPLACE FUNCTION public.sanitize_lead_phone_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_phone TEXT;
BEGIN
  IF NEW.phone IS NOT NULL THEN
    -- 1. Remove tudo que não é número
    v_phone := regexp_replace(NEW.phone, '[^0-9]', '', 'g');
    
    -- 2. Remove o zero à esquerda se existir (ex: 011 -> 11)
    IF left(v_phone, 1) = '0' THEN
       v_phone := substr(v_phone, 2);
    END IF;

    -- 3. Adiciona o código do país (55) se o número for curto demais (10 ou 11 dígitos)
    -- Ex: 11999998888 (11) -> 5511999998888 (13)
    -- Ex: 1188887777 (10) -> 551188887777 (12)
    IF length(v_phone) = 11 OR length(v_phone) = 10 THEN
       v_phone := '55' || v_phone;
    END IF;

    -- 4. Injeta o nono dígito "9" se tiver 12 dígitos e começar com 55
    -- Ex: 551188887777 (12) -> 5511988887777 (13)
    IF length(v_phone) = 12 AND left(v_phone, 2) = '55' THEN
       v_phone := left(v_phone, 4) || '9' || right(v_phone, 8);
    END IF;

    -- 5. Se o número for apenas 8 ou 9 dígitos (sem DDD), assume-se que falta o 55 + DDD. 
    -- Como não sabemos o DDD, deixamos como está, mas se tiver 8 dígitos e for num contexto de celular, injeta o 9.
    -- (Opcional, mas perigoso sem saber o DDD)

    NEW.phone := v_phone;

    IF NEW.phone = '' THEN
      NEW.phone := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Replica a mesma lógica para a sanização das instâncias da clínica
CREATE OR REPLACE FUNCTION public.sanitize_whatsapp_phone_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_phone TEXT;
BEGIN
  IF NEW.phone_number IS NOT NULL THEN
    v_phone := regexp_replace(NEW.phone_number, '[^0-9]', '', 'g');
    
    IF left(v_phone, 1) = '0' THEN
       v_phone := substr(v_phone, 2);
    END IF;

    IF length(v_phone) = 11 OR length(v_phone) = 10 THEN
       v_phone := '55' || v_phone;
    END IF;

    IF length(v_phone) = 12 AND left(v_phone, 2) = '55' THEN
       v_phone := left(v_phone, 4) || '9' || right(v_phone, 8);
    END IF;

    NEW.phone_number := v_phone;

    IF NEW.phone_number = '' THEN
      NEW.phone_number := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
