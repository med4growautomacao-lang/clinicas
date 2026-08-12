-- 20260724181708_20260724360000_onboarding_rehost_avatars_cron
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Cron do re-host de avatares: a cada 3 min, processa até 40 leads recentes com foto pps.whatsapp.net
-- (re-hospeda os vivos no bucket lead-avatars, zera os mortos). Sem candidatos = scanned 0, barato.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='onboarding_rehost_avatars') THEN
    PERFORM cron.unschedule('onboarding_rehost_avatars');
  END IF;
END $$;
SELECT cron.schedule('onboarding_rehost_avatars', '*/3 * * * *',
  $cmd$select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/onboarding-rehost-avatars', '{"Content-Type":"application/json"}'::jsonb, '{}'::jsonb, 60000)$cmd$);
