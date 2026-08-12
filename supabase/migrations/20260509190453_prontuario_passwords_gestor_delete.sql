-- 20260509190453_prontuario_passwords_gestor_delete
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE POLICY "gestor_can_reset_pin" ON prontuario_passwords
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id = prontuario_passwords.clinic_id
        AND cu.role = 'gestor'
    )
  );
