-- 20260513201933_normalize_phone_to_55_ddd_8digits
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Função única de normalização (reusável em leads e patients)
CREATE OR REPLACE FUNCTION public.normalize_br_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v text;
BEGIN
  IF p_phone IS NULL OR p_phone = '' THEN RETURN NULL; END IF;
  v := regexp_replace(p_phone, '[^0-9]', '', 'g');           -- só dígitos
  IF v = '' THEN RETURN NULL; END IF;
  IF left(v, 1) = '0' THEN v := substr(v, 2); END IF;       -- tira 0 à esquerda
  IF length(v) = 11 THEN v := '55' || v; END IF;            -- 11→13 (DDI faltava)
  IF length(v) = 10 THEN v := '55' || v; END IF;            -- 10→12 (DDI faltava, sem 9)
  -- Se 13 dígitos começando com 55 e 9 no índice 5 → remove o 9 (padrão 12 dígitos)
  IF length(v) = 13 AND left(v, 2) = '55' AND substr(v, 5, 1) = '9' THEN
    v := substr(v, 1, 4) || substr(v, 6);
  END IF;
  RETURN v;
END;
$$;

-- Atualiza trigger leads pra usar a função única
CREATE OR REPLACE FUNCTION public.sanitize_lead_phone_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone := normalize_br_phone(NEW.phone);
  RETURN NEW;
END;
$$;

-- Cria trigger igual em patients
CREATE OR REPLACE FUNCTION public.fn_sanitize_patient_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.phone := normalize_br_phone(NEW.phone);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_sanitize_patient_phone ON public.patients;
CREATE TRIGGER tr_sanitize_patient_phone
  BEFORE INSERT OR UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.fn_sanitize_patient_phone();

-- Normaliza retroativamente: leads de 13 dígitos viram 12
-- Cuidado: se já existe lead com phone 12 dígitos igual, vai criar duplicata. Vou usar DISTINCT.
WITH dups AS (
  SELECT l.id, normalize_br_phone(l.phone) AS new_phone
  FROM leads l
  WHERE length(regexp_replace(l.phone, '[^0-9]', '', 'g')) = 13
    AND normalize_br_phone(l.phone) <> l.phone
)
UPDATE leads SET phone = (SELECT new_phone FROM dups WHERE dups.id = leads.id)
WHERE id IN (SELECT id FROM dups)
  AND NOT EXISTS (
    SELECT 1 FROM leads l2 WHERE l2.clinic_id = leads.clinic_id
      AND l2.phone = (SELECT new_phone FROM dups WHERE dups.id = leads.id)
      AND l2.id <> leads.id
  );

-- Normaliza o lead da Amália (force re-update pra disparar trigger se ficou de fora)
UPDATE leads SET phone = phone WHERE id = '5f8de3f1-709f-4ac6-871b-9b520ec82a36';
