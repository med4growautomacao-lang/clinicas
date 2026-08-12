-- 20260509185840_update_prontuario_passwords_rls
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Allow authenticated user to insert/update their own password record
CREATE POLICY "user_insert_own_password" ON prontuario_passwords
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_update_own_password" ON prontuario_passwords
  FOR UPDATE USING (auth.uid() = user_id);
