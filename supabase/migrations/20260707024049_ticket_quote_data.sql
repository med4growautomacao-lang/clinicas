-- 20260707024049_ticket_quote_data
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS quote_data jsonb;
