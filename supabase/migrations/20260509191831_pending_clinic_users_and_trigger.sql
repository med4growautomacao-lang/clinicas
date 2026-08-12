-- 20260509191831_pending_clinic_users_and_trigger
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Tabela de pré-cadastro de médicos (sem conta auth ainda)
CREATE TABLE pending_clinic_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  email      text NOT NULL,
  full_name  text NOT NULL,
  role       text NOT NULL CHECK (role IN ('medico', 'medico_gestor')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (email, clinic_id)
);

-- Trigger: quando um usuário confirma conta, verifica se é médico pré-cadastrado
CREATE OR REPLACE FUNCTION fn_activate_pending_clinic_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  pending pending_clinic_users%ROWTYPE;
BEGIN
  -- Só age quando o email é confirmado (email_confirmed_at muda de NULL para valor)
  IF (TG_OP = 'UPDATE' AND OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL) THEN
    SELECT * INTO pending
    FROM pending_clinic_users
    WHERE LOWER(email) = LOWER(NEW.email)
    LIMIT 1;

    IF FOUND THEN
      INSERT INTO clinic_users (id, clinic_id, full_name, email, role, created_at)
      VALUES (NEW.id, pending.clinic_id, pending.full_name, NEW.email, pending.role, NOW())
      ON CONFLICT (id) DO NOTHING;

      DELETE FROM pending_clinic_users WHERE id = pending.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_activate_pending_clinic_user
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION fn_activate_pending_clinic_user();
