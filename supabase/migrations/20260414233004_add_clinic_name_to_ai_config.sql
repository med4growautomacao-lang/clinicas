-- 20260414233004_add_clinic_name_to_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS clinic_name text;

UPDATE ai_config ac
SET clinic_name = c.name
FROM clinics c
WHERE ac.clinic_id = c.id;
