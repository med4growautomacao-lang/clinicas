-- A checagem de conexao rodava 2x por dia (09h e 18h SP). Uma queda as 09h05 so
-- era descoberta as 18h: ate ~9h de clinica muda, com o agente recusando turno e
-- todo envio automatico parado.
--
-- Agora sao duas frentes:
--   whatsapp_sync_status_rapido  a cada 5 min, so reconciliacao (Parte 1)
--   whatsapp_sync_status         1x/dia as 09h, passada completa com ?dedupe=1
--
-- Custo do rapido: UMA chamada GET /instance/all cobre todas as instancias, mais
-- uma leitura individual por instancia suspeita (quase sempre zero). 288 execucoes
-- por dia, nao 288 por instancia.
--
-- A Parte 2 (limpeza de webhooks duplicados) e a lenta (~30 instancias x 500ms) e
-- por isso ficou so na passada diaria. Era ela que estourava o timeout do chamador
-- e deixava o resultado invisivel.
--
-- timeout_milliseconds explicito: o default de 5000 fazia TODA execucao ser
-- registrada como timed_out no pg_net, e o monitor de edge exclui timeout de
-- proposito. Ou seja, o desfecho desta funcao nunca chegava na Central.
select cron.unschedule('whatsapp_sync_status');

select cron.schedule(
  'whatsapp_sync_status',
  '0 12 * * *',
  $cron$
  select public.system_http_post(
    'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-sync-status?dedupe=1',
    '{"Content-Type": "application/json"}'::jsonb,
    '{}'::jsonb,
    60000
  );
  $cron$
);

select cron.schedule(
  'whatsapp_sync_status_rapido',
  '*/5 * * * *',
  $cron$
  select public.system_http_post(
    'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-sync-status',
    '{"Content-Type": "application/json"}'::jsonb,
    '{}'::jsonb,
    25000
  );
  $cron$
);
