-- 20260415120639_add_test_mode_to_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE ai_config
  ADD COLUMN IF NOT EXISTS test_mode_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS test_numbers text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS test_reset_phrase text NOT NULL DEFAULT '';
