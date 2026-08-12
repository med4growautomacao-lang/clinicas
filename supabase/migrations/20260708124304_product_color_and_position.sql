-- 20260708124304_product_color_and_position
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Cor de preenchimento (tag visual) e ordem manual dos produtos no catálogo.
ALTER TABLE products ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN products.color IS 'Cor de preenchimento (tag visual) do produto no catálogo.';
COMMENT ON COLUMN products.position IS 'Ordem manual do produto no catálogo (asc).';

-- Backfill: posição sequencial por clínica, na ordem atual (por nome).
WITH ranked AS (
  SELECT id, (row_number() OVER (PARTITION BY clinic_id ORDER BY name)) - 1 AS rn
  FROM products
)
UPDATE products p SET position = r.rn FROM ranked r WHERE p.id = r.id;
