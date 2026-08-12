-- 20260410154122_add_category_to_clinics
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS category text DEFAULT NULL;
