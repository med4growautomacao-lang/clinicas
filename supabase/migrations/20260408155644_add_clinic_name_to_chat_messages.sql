-- 20260408155644_add_clinic_name_to_chat_messages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adicionar coluna
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS clinic_name text;

-- Preencher registros existentes
UPDATE public.chat_messages cm
SET clinic_name = c.name
FROM public.clinics c
WHERE c.id = cm.clinic_id AND cm.clinic_name IS NULL;

-- Trigger para preencher automaticamente em novos registros
CREATE OR REPLACE FUNCTION public.fill_clinic_name_on_chat_message()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.clinic_name IS NULL AND NEW.clinic_id IS NOT NULL THEN
    SELECT name INTO NEW.clinic_name FROM public.clinics WHERE id = NEW.clinic_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_clinic_name_chat_message ON public.chat_messages;
CREATE TRIGGER trg_fill_clinic_name_chat_message
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.fill_clinic_name_on_chat_message();

-- Trigger para sincronizar quando o nome da clínica mudar
CREATE OR REPLACE FUNCTION public.sync_clinic_name_to_chat_messages()
  RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.chat_messages SET clinic_name = NEW.name WHERE clinic_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_clinic_name_chat_messages ON public.clinics;
CREATE TRIGGER trg_sync_clinic_name_chat_messages
  AFTER UPDATE OF name ON public.clinics
  FOR EACH ROW EXECUTE FUNCTION public.sync_clinic_name_to_chat_messages();
