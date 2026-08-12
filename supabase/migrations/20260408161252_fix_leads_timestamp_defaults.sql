-- 20260408161252_fix_leads_timestamp_defaults
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remover defaults incorretos
ALTER TABLE public.leads ALTER COLUMN followup_sent_at SET DEFAULT NULL;
ALTER TABLE public.leads ALTER COLUMN confirm_sent_at SET DEFAULT NULL;
ALTER TABLE public.leads ALTER COLUMN handoff_triggered_at SET DEFAULT NULL;
ALTER TABLE public.leads ALTER COLUMN last_outbound_at SET DEFAULT NULL;

-- Zerar registros onde o valor foi gerado automaticamente (igual ao created_at)
UPDATE public.leads SET followup_sent_at = NULL WHERE followup_sent_at = created_at;
UPDATE public.leads SET confirm_sent_at = NULL WHERE confirm_sent_at = created_at;
UPDATE public.leads SET handoff_triggered_at = NULL WHERE handoff_triggered_at = created_at;
UPDATE public.leads SET last_outbound_at = NULL WHERE last_outbound_at = created_at;
