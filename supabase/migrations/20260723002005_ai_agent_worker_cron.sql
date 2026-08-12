-- 20260723002005_ai_agent_worker_cron
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

do $cleanup$
begin
  perform cron.unschedule('ai_agent_worker_sweep');
exception when others then null;
end $cleanup$;

select cron.schedule(
  'ai_agent_worker_sweep',
  '* * * * *',
  $$
    select public.system_http_post(
      'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/ai-agent-worker',
      '{"Content-Type":"application/json"}'::jsonb,
      '{"mode":"sweep"}'::jsonb,
      5000
    );
  $$
);
