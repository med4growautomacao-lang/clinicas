-- 20260410105525_remove_9th_digit_from_lead_phone_sanitize
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION sanitize_lead_phone_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
    IF length(v_phone) = 11 OR length(v_phone) = 10 THEN
       v_phone := '55' || v_phone;
    END IF;

    -- Sem adição automática do 9 — n8n já formata corretamente

    NEW.phone := v_phone;

    IF NEW.phone = '' THEN
      NEW.phone := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
