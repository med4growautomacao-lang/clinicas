-- 20260420170946_auto_delete_pending_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

SELECT cron.schedule(
  'delete_pending_leads',
  '* * * * *',
  $$
    DELETE FROM leads
    WHERE name ILIKE 'Lead Pendente%'
      AND updated_at < NOW() - INTERVAL '10 minutes';
  $$
);
