-- 20260406200038_update_forms_followup_cron_to_1_minute
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'forms-followup-job'),
  schedule := '* * * * *'
);
