-- 20260409231334_rename_csat_delay_hours_to_minutes
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE ai_config
  RENAME COLUMN csat_delay_hours TO csat_delay_minutes;

ALTER TABLE ai_config
  ALTER COLUMN csat_delay_minutes SET DEFAULT 120;
