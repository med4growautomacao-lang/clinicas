-- 20260509192528_fix_trigger_schema_prefix
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION fn_activate_pending_clinic_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pending public.pending_clinic_users%ROWTYPE;
BEGIN
  IF (TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL) THEN
    SELECT * INTO pending
    FROM public.pending_clinic_users
    WHERE LOWER(email) = LOWER(NEW.email)
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO public.clinic_users (id, clinic_id, full_name, email, role, created_at)
      VALUES (NEW.id, pending.clinic_id, pending.full_name, NEW.email, pending.role, NOW())
      ON CONFLICT (id) DO NOTHING;

      DELETE FROM public.pending_clinic_users WHERE id = pending.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
