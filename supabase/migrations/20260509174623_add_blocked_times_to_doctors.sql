-- 20260509174623_add_blocked_times_to_doctors
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE doctors ADD COLUMN IF NOT EXISTS blocked_times JSONB DEFAULT '[]'::jsonb;
