-- 20260414233741_add_clinic_name_to_stage_transition_rules
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE stage_transition_rules ADD COLUMN IF NOT EXISTS clinic_name text;

UPDATE stage_transition_rules str
SET clinic_name = c.name
FROM clinics c
WHERE str.clinic_id = c.id;
