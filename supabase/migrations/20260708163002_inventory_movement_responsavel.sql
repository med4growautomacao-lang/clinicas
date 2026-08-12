-- 20260708163002_inventory_movement_responsavel
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS responsavel text;
