-- 20260410133846_default_auto_schedule_false
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE ai_config ALTER COLUMN auto_schedule SET DEFAULT false;
