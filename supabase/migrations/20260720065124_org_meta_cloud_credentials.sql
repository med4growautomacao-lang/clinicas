-- 20260720065124_org_meta_cloud_credentials
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Credenciais da WhatsApp Cloud API oficial no nível da ORGANIZAÇÃO (mesmo padrão do
-- google_ad_mcc_id/google_ad_mcc_token). Configuradas na UI (Gestão Org › Configurações ›
-- API Meta) e lidas pela edge meta-cloud-api via a organização da clínica.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS meta_cloud_token   text,
  ADD COLUMN IF NOT EXISTS meta_cloud_waba_id text;

COMMENT ON COLUMN public.organizations.meta_cloud_token   IS 'Access token (System User) da WhatsApp Cloud API — usado pela edge meta-cloud-api. Sensível.';
COMMENT ON COLUMN public.organizations.meta_cloud_waba_id IS 'WhatsApp Business Account ID (WABA) da org — usado para criar/listar templates.';
