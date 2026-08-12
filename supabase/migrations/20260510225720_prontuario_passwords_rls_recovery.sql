-- 20260510225720_prontuario_passwords_rls_recovery
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Permite medico/medico_gestor ler pin_encrypted de médicos da mesma clínica
CREATE POLICY prontuario_passwords_clinic_read ON prontuario_passwords
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM clinic_users cu_req
    JOIN clinic_users cu_doc ON cu_req.clinic_id = cu_doc.clinic_id
    WHERE cu_req.id = auth.uid()
      AND cu_req.role IN ('medico', 'medico_gestor')
      AND cu_doc.id = prontuario_passwords.user_id
  )
);

-- Permite usuário atualizar seu próprio pin_encrypted
CREATE POLICY prontuario_passwords_update_own ON prontuario_passwords
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
