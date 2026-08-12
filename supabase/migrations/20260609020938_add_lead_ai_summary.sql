-- 20260609020938_add_lead_ai_summary
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ai_summary text;

COMMENT ON COLUMN public.leads.ai_summary IS
  'Resumo persistente (perfil) do lead, gerado/atualizado pela IA. Texto livre injetado no contexto da IA.';
