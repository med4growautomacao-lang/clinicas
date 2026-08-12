-- 20260528000207_drop_appointments_modality_check
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_modality_check;
