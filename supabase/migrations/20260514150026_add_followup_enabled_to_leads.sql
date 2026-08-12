-- 20260514150026_add_followup_enabled_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS followup_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN leads.followup_enabled IS
  'Liga/desliga os automatismos de follow-up (reengajamento + confirmação de consulta) para este lead. Default true.';
