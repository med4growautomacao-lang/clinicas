-- 20260721151005_conv_ai_schedulers
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

SELECT cron.unschedule('conv_ai_analyst') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conv_ai_analyst');
SELECT cron.schedule('conv_ai_analyst', '*/5 * * * *', $cron$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/conv-ai-analyst');
$cron$);

SELECT cron.unschedule('conv_ai_learn') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conv_ai_learn');
SELECT cron.schedule('conv_ai_learn', '20 4 * * *', $cron$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/conv-ai-learn');
$cron$);
