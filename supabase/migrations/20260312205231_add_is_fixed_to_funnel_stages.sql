-- 20260312205231_add_is_fixed_to_funnel_stages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS is_fixed boolean DEFAULT false;
