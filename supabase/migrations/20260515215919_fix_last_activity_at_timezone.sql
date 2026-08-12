-- 20260515215919_fix_last_activity_at_timezone
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads
  ALTER COLUMN last_activity_at TYPE timestamp without time zone
  USING (last_activity_at AT TIME ZONE 'UTC');
