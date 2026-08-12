-- 20260610041009_guard_sync_clinic_name_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.sync_clinic_name_to_leads()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE leads SET clinic_name = NEW.name WHERE clinic_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
