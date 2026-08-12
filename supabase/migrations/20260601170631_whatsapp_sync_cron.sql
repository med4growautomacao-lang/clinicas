-- 20260601170631_whatsapp_sync_cron
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

do $cleanup$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'whatsapp_sync_status';
exception when others then null;
end $cleanup$;

select cron.schedule(
  'whatsapp_sync_status',
  '0 12,21 * * *',
  $$
    select net.http_post(
      url     := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-sync-status',
      headers := jsonb_build_object('Content-Type','application/json'),
      body    := '{}'::jsonb
    );
  $$
);

commit;
