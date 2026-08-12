-- 20260422144224_lead_default_ticket_value
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_set_default_ticket_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default NUMERIC;
BEGIN
  -- Só aplica se estimated_value chegou nulo ou zero
  IF COALESCE(NEW.estimated_value, 0) > 0 THEN
    RETURN NEW;
  END IF;

  SELECT default_ticket_value INTO v_default
  FROM ai_config
  WHERE clinic_id = NEW.clinic_id
  LIMIT 1;

  IF v_default IS NOT NULL AND v_default > 0 THEN
    NEW.estimated_value := v_default;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_default_ticket_value
  BEFORE INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_default_ticket_value();
