-- 20260509184741_create_prontuario_passwords
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE prontuario_passwords (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, clinic_id)
);

ALTER TABLE prontuario_passwords ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own_password" ON prontuario_passwords
  FOR SELECT USING (auth.uid() = user_id);
