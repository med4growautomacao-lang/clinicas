-- 20260502134431_add_avatar_url_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS avatar_url TEXT;
