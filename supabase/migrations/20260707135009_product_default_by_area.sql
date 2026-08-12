-- 20260707135009_product_default_by_area
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.products ALTER COLUMN charge_by_area SET DEFAULT true;
