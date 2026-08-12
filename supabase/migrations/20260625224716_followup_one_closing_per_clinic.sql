-- 20260625224716_followup_one_closing_per_clinic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Garante no máximo 1 passo de encerramento (is_closing) por clínica.
create unique index if not exists uq_followup_steps_one_closing
  on public.followup_steps (clinic_id)
  where is_closing;
