-- 20260415175400_add_order_index_to_transition_rules
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE stage_transition_rules
  ADD COLUMN IF NOT EXISTS order_index integer NOT NULL DEFAULT 0;

-- Initialize existing rows sequentially per clinic based on created_at
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY clinic_id ORDER BY created_at) - 1 AS rn
  FROM stage_transition_rules
)
UPDATE stage_transition_rules
SET order_index = ordered.rn
FROM ordered
WHERE stage_transition_rules.id = ordered.id;
