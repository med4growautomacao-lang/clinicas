-- 20260507183045_add_outcome_at_to_tickets
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE tickets ADD COLUMN outcome_at TIMESTAMPTZ;
