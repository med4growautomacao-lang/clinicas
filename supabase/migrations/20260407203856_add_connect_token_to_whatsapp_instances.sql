-- 20260407203856_add_connect_token_to_whatsapp_instances
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS connect_token UUID UNIQUE;
