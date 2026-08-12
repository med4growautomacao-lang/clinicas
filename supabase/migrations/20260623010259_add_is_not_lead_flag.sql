-- 20260623010259_add_is_not_lead_flag
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- "Não Lead": marca um registro como NÃO sendo uma oportunidade real.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_not_lead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS not_lead_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_not_lead
  ON public.leads (clinic_id, not_lead_at DESC) WHERE is_not_lead;
