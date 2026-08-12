-- 20260511011129_prontuario_per_user_pin_shared_clinic_key
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Revert prontuario_passwords to per-user (user_id + clinic_id)
ALTER TABLE prontuario_passwords
  DROP CONSTRAINT IF EXISTS prontuario_passwords_clinic_id_key;

ALTER TABLE prontuario_passwords
  ADD CONSTRAINT prontuario_passwords_user_id_clinic_id_key UNIQUE (user_id, clinic_id);

-- 2. Drop clinic-level policies from previous migration
DROP POLICY IF EXISTS "clinic_member_select" ON prontuario_passwords;
DROP POLICY IF EXISTS "clinic_member_insert" ON prontuario_passwords;
DROP POLICY IF EXISTS "clinic_member_update" ON prontuario_passwords;
DROP POLICY IF EXISTS "gestor_delete"        ON prontuario_passwords;

-- 3. Restore per-user policies
CREATE POLICY "user_own_password" ON prontuario_passwords
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_insert_own" ON prontuario_passwords
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_update_own" ON prontuario_passwords
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "gestor_can_reset" ON prontuario_passwords
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id = prontuario_passwords.clinic_id
        AND cu.role IN ('gestor', 'medico_gestor')
    )
  );

-- 4. Create clinic_enc_keys: one AES-256 key per clinic, shared among all doctors
CREATE TABLE IF NOT EXISTS clinic_enc_keys (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  enc_key    text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (clinic_id)
);

ALTER TABLE clinic_enc_keys ENABLE ROW LEVEL SECURITY;

-- Any clinic member can read the clinic key (after PIN verification in the app)
CREATE POLICY "clinic_member_read" ON clinic_enc_keys
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM clinic_users WHERE id = auth.uid())
  );

-- Any clinic member can insert the key (first setup)
CREATE POLICY "clinic_member_insert" ON clinic_enc_keys
  FOR INSERT WITH CHECK (
    clinic_id IN (SELECT clinic_id FROM clinic_users WHERE id = auth.uid())
  );
