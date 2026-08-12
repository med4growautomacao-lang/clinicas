-- 20260707133223_product_charge_by_area
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS charge_by_area boolean NOT NULL DEFAULT false;
