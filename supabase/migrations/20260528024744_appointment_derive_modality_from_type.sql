-- 20260528024744_appointment_derive_modality_from_type
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Quando o INSERT/UPDATE traz consultation_type_id, deriva modality e consultation_type_slug do tipo.
-- Roda antes do trigger de duração pra que ele veja o slug preenchido.
CREATE OR REPLACE FUNCTION public.fn_appointment_derive_modality_from_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_ct RECORD;
BEGIN
  IF NEW.consultation_type_id IS NOT NULL THEN
    SELECT id, slug, modality INTO v_ct FROM consultation_types
    WHERE id = NEW.consultation_type_id;
    IF FOUND THEN
      NEW.modality := v_ct.modality;
      NEW.consultation_type_slug := v_ct.slug;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 'trg_aa_' prefix garante execução antes de 'trg_appointment_inherit_doctor_duration'
DROP TRIGGER IF EXISTS trg_aa_appointment_derive_modality_from_type ON public.appointments;
CREATE TRIGGER trg_aa_appointment_derive_modality_from_type
BEFORE INSERT OR UPDATE OF consultation_type_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.fn_appointment_derive_modality_from_type();
