-- 20260313001041_add_name_to_aiconfig
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS name text;
