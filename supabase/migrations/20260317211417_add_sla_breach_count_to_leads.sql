-- 20260317211417_add_sla_breach_count_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS sla_breach_count integer NOT NULL DEFAULT 0;
