-- 20260623165014_meta_forms_sync_cron
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

do $cleanup$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'meta_forms_sync';
exception when others then null;
end $cleanup$;

select cron.schedule(
  'meta_forms_sync',
  '* * * * *',
  $cmd$
    select net.http_post(
      url     := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/meta-forms-sync',
      headers := jsonb_build_object('Content-Type','application/json'),
      body    := '{}'::jsonb
    );
  $cmd$
);
