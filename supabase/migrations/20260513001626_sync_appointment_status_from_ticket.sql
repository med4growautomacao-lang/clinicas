-- 20260513001626_sync_appointment_status_from_ticket
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_sync_appointment_status_from_ticket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_slug text;
  v_target_status text;
  v_appt_id uuid;
BEGIN
  IF NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = NEW.stage_id;

  v_target_status := CASE v_new_slug
    WHEN 'compareceu' THEN 'compareceu'
    WHEN 'faltou_cancelou' THEN 'cancelado'
    ELSE NULL
  END;

  IF v_target_status IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_appt_id
  FROM appointments
  WHERE ticket_id = NEW.id
    AND status NOT IN ('compareceu', 'realizado', 'cancelado', 'faltou')
  ORDER BY date ASC, time ASC
  LIMIT 1;

  IF v_appt_id IS NULL THEN RETURN NEW; END IF;

  UPDATE appointments
    SET status = v_target_status
  WHERE id = v_appt_id
    AND status IS DISTINCT FROM v_target_status;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_appointment_status_from_ticket ON public.tickets;
CREATE TRIGGER trg_sync_appointment_status_from_ticket
  AFTER UPDATE OF stage_id ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_appointment_status_from_ticket();
