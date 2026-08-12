-- 20260709130916_custo_real_mao_obra_fixos
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS custo_mao_obra_hora numeric NOT NULL DEFAULT 0;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS custo_fixo_hora numeric NOT NULL DEFAULT 0;
