-- 20260609024756_add_lead_session_id
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS session_id text;

CREATE INDEX IF NOT EXISTS idx_leads_session_id
  ON public.leads (session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.leads.session_id IS
  'ID de sessão da IA (n8n) associado ao lead, usado como chave de memória da conversa.';
