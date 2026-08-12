-- 20260507181053_tickets_outcome_and_loss_reason
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adiciona colunas novas
ALTER TABLE tickets
  ADD COLUMN outcome TEXT CHECK (outcome IN ('ganho', 'perdido')),
  ADD COLUMN loss_reason TEXT;

-- Migra dados existentes
UPDATE tickets SET outcome = close_reason WHERE close_reason IN ('ganho', 'perdido');
UPDATE tickets SET outcome = 'ganho' WHERE close_reason = 'nps_enviado';

-- Remove coluna antiga
ALTER TABLE tickets DROP COLUMN close_reason;
