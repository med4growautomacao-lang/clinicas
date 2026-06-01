-- WhatsApp status sync cron
--
-- Why: webhooks de connection da uazapi podem ser perdidos (rede, restart,
-- bug pontual). Sem reconciliacao periodica, o DB pode reportar 'connected'
-- enquanto a instancia real esta desconectada. Esta migration agenda uma
-- chamada para a edge function whatsapp-sync-status duas vezes por dia,
-- 09:00 e 18:00 BRT (12:00 e 21:00 UTC).

begin;

-- Remove job anterior se existir
do $cleanup$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'whatsapp_sync_status';
exception when others then null;
end $cleanup$;

-- Agenda. 0 12 = 09:00 BRT, 0 21 = 18:00 BRT (assumindo UTC-3 sem horario de verao)
select cron.schedule(
  'whatsapp_sync_status',
  '0 12,21 * * *',
  $cmd$
    select net.http_post(
      url     := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-sync-status',
      headers := jsonb_build_object('Content-Type','application/json'),
      body    := '{}'::jsonb
    );
  $cmd$
);

commit;
