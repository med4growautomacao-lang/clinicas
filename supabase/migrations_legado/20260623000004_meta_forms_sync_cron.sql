-- Agenda a captação de leads do Formulário Nativo do Meta a cada 1 minuto.
--
-- Espelha o padrão de 20260601000003_whatsapp_sync_cron: pg_cron -> net.http_post chamando a Edge
-- Function meta-forms-sync (deployada com verify_jwt=false, igual à whatsapp-sync-status). A função
-- é no-op enquanto nenhuma clínica tiver meta_forms_id + meta_token preenchidos.

begin;

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

commit;
