-- 20260714023941_crons_usam_system_http_post
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Os crons que chamam edge passam a sair por system_http_post(), que registra id → URL.
-- Sem isso, a resposta de erro chega em net._http_response SEM a URL (a fila é apagada), e a Central
-- saberia que "algo falhou" mas não O QUÊ — inútil na prática.

select cron.unschedule('meta_forms_sync');
select cron.schedule('meta_forms_sync', '* * * * *', $$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/meta-forms-sync');
$$);

select cron.unschedule('whatsapp_sync_status');
select cron.schedule('whatsapp_sync_status', '0 12,21 * * *', $$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-sync-status');
$$);

select cron.unschedule('ctwa_enrich_weekly');
select cron.schedule('ctwa_enrich_weekly', '0 12 * * 1', $$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/ctwa-enrich');
$$);
