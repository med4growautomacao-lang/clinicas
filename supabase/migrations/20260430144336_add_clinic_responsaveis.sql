-- 20260430144336_add_clinic_responsaveis
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS gestor_trafego_id uuid,
  ADD COLUMN IF NOT EXISTS admin_responsavel_id uuid;
