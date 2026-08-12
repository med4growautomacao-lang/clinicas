-- 20260402221201_add_wa_pre_msg_to_clinics
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS wa_pre_msg TEXT;
