-- 20260510214458_medical_records_vitals_to_text
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE medical_records
  ALTER COLUMN weight TYPE text,
  ALTER COLUMN height TYPE text,
  ALTER COLUMN blood_pressure TYPE text,
  ALTER COLUMN temperature TYPE text;
