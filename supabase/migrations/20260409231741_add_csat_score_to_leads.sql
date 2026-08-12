-- 20260409231741_add_csat_score_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS csat_score       integer  CHECK (csat_score BETWEEN 0 AND 10),
  ADD COLUMN IF NOT EXISTS csat_answered_at timestamptz;
