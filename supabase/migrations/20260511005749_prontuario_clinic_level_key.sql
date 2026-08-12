-- 20260511005749_prontuario_clinic_level_key
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Delete test data that can't be decrypted (key mismatch)
DELETE FROM medical_records WHERE description LIKE 'enc:%' OR diagnosis LIKE 'enc:%';
DELETE FROM prontuario_passwords;

-- 2. Drop old unique constraint (user_id, clinic_id) and add clinic_id UNIQUE
ALTER TABLE prontuario_passwords
  DROP CONSTRAINT prontuario_passwords_user_id_clinic_id_key;

ALTER TABLE prontuario_passwords
  ADD CONSTRAINT prontuario_passwords_clinic_id_key UNIQUE (clinic_id);

-- 3. Drop all existing RLS policies
DROP POLICY IF EXISTS "user_own_password"              ON prontuario_passwords;
DROP POLICY IF EXISTS "gestor_can_reset_pin"           ON prontuario_passwords;
DROP POLICY IF EXISTS "prontuario_passwords_clinic_read" ON prontuario_passwords;
DROP POLICY IF EXISTS "prontuario_passwords_update_own"  ON prontuario_passwords;
DROP POLICY IF EXISTS "user_insert_own_password"         ON prontuario_passwords;
DROP POLICY IF EXISTS "user_update_own_password"         ON prontuario_passwords;

-- 4. New clinic-level RLS policies
-- SELECT: any medico/medico_gestor in the clinic
CREATE POLICY "clinic_member_select" ON prontuario_passwords
  FOR SELECT USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users
      WHERE id = auth.uid()
        AND role IN ('medico', 'medico_gestor', 'gestor')
    )
  );

-- INSERT: any clinic member (first setup)
CREATE POLICY "clinic_member_insert" ON prontuario_passwords
  FOR INSERT WITH CHECK (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users
      WHERE id = auth.uid()
    )
  );

-- UPDATE: any clinic member (update hash or pin_encrypted)
CREATE POLICY "clinic_member_update" ON prontuario_passwords
  FOR UPDATE USING (
    clinic_id IN (
      SELECT clinic_id FROM clinic_users
      WHERE id = auth.uid()
    )
  );

-- DELETE: gestor can reset
CREATE POLICY "gestor_delete" ON prontuario_passwords
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id = prontuario_passwords.clinic_id
        AND cu.role IN ('gestor', 'medico_gestor')
    )
  );
