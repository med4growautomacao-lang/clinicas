-- 20260408161643_set_last_activity_at_default_on_lead_insert
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Novos leads nascem com last_activity_at = created_at
CREATE OR REPLACE FUNCTION public.fn_set_default_last_activity()
 RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_activity_at IS NULL THEN
    NEW.last_activity_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_default_last_activity ON public.leads;
CREATE TRIGGER trg_set_default_last_activity
  BEFORE INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_default_last_activity();
