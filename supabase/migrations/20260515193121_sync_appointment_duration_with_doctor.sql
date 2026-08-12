-- 20260515193121_sync_appointment_duration_with_doctor
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1) BEFORE INSERT em appointments: herda consultation_duration do médico
CREATE OR REPLACE FUNCTION public.fn_appointment_inherit_doctor_duration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dur int;
BEGIN
  SELECT COALESCE(consultation_duration, 60) INTO v_dur
  FROM doctors WHERE id = NEW.doctor_id;
  IF v_dur IS NOT NULL THEN
    NEW.duration_minutes := v_dur;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_appointment_inherit_doctor_duration ON public.appointments;
CREATE TRIGGER trg_appointment_inherit_doctor_duration
BEFORE INSERT ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.fn_appointment_inherit_doctor_duration();

-- 2) AFTER UPDATE em doctors: quando consultation_duration muda, atualiza
--    appointments pendentes/confirmados desse médico.
CREATE OR REPLACE FUNCTION public.fn_sync_appointments_on_doctor_duration_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.consultation_duration IS DISTINCT FROM OLD.consultation_duration THEN
    UPDATE public.appointments
    SET duration_minutes = COALESCE(NEW.consultation_duration, 60)
    WHERE doctor_id = NEW.id
      AND status IN ('pendente', 'confirmado');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_appointments_on_doctor_duration ON public.doctors;
CREATE TRIGGER trg_sync_appointments_on_doctor_duration
AFTER UPDATE ON public.doctors
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_appointments_on_doctor_duration_change();

-- 3) Backfill: alinha appointments pendentes/confirmados existentes
--    com o consultation_duration atual de cada médico.
UPDATE public.appointments a
SET duration_minutes = COALESCE(d.consultation_duration, 60)
FROM public.doctors d
WHERE a.doctor_id = d.id
  AND a.status IN ('pendente', 'confirmado')
  AND a.duration_minutes IS DISTINCT FROM COALESCE(d.consultation_duration, 60);
