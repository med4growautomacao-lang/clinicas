-- 20260326141649_add_manual_appointments_count_to_marketing_data
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.marketing_data ADD COLUMN IF NOT EXISTS manual_appointments_count INTEGER;
COMMENT ON COLUMN public.marketing_data.manual_appointments_count IS 'Manual override for the number of appointments per platform/date';
