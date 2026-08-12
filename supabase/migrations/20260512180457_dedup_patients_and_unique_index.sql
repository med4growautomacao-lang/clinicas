-- 20260512180457_dedup_patients_and_unique_index
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Caso 1: (91) 99929-7413 — migra appointment do dup pro principal
UPDATE appointments SET patient_id = 'fec825b1-b3ea-44c4-b68f-98bbfc661012'
 WHERE patient_id = 'ffae2ee2-aa01-44a8-babb-43cd3cd12c69';

-- Caso 2: 553599433573 — dup já sem referências
-- Deleta os dois dups
DELETE FROM patients WHERE id IN (
  'ffae2ee2-aa01-44a8-babb-43cd3cd12c69',
  '3eb8e065-9fb8-42a3-833f-0a45c16e42a9'
);

-- Previne duplicatas futuras
CREATE UNIQUE INDEX IF NOT EXISTS patients_clinic_phone_uniq
  ON patients (clinic_id, phone)
  WHERE phone IS NOT NULL;
