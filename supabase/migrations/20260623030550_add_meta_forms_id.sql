-- 20260623030550_add_meta_forms_id
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS meta_forms_id text;

COMMENT ON COLUMN public.clinics.meta_forms_id IS 'ID do formulário nativo do Meta (Lead Ads / Instant Forms) usado para vincular leads do formulário à clínica';
