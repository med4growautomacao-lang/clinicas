-- 20260707151834_clinic_legal_name
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Nome completo/razão social da empresa, exibido no cabeçalho do orçamento junto da logo.
-- Se vazio, o documento cai no `name` (nome curto da clínica).
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS legal_name text;
COMMENT ON COLUMN clinics.legal_name IS 'Nome completo / razão social da empresa (cabeçalho do orçamento, junto da logo). Fallback = name.';
