-- 20260409220757_remove_auto_9_from_phone_sanitize
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION sanitize_whatsapp_phone_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_phone TEXT;
BEGIN
  IF NEW.phone_number IS NOT NULL THEN
    -- Remove tudo que não é dígito
    v_phone := regexp_replace(NEW.phone_number, '[^0-9]', '', 'g');

    -- Remove zero inicial
    IF left(v_phone, 1) = '0' THEN
       v_phone := substr(v_phone, 2);
    END IF;

    -- Adiciona código do Brasil se vier sem
    IF length(v_phone) = 11 OR length(v_phone) = 10 THEN
       v_phone := '55' || v_phone;
    END IF;

    -- Sem adição automática do 9 — n8n já formata corretamente

    NEW.phone_number := v_phone;

    IF NEW.phone_number = '' THEN
      NEW.phone_number := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
