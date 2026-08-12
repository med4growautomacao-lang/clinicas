-- 20260420171112_update_pending_leads_cron
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

SELECT cron.unschedule('delete_pending_leads');

SELECT cron.schedule(
  'delete_pending_leads',
  '*/10 * * * *',
  $$
    DELETE FROM leads
    WHERE name ILIKE 'Lead Pendente%'
      AND created_at < NOW() - INTERVAL '10 minutes';
  $$
);
