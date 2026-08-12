-- 20260724180221_20260724350000_onboarding_deep_sync_cron
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Cron do deep-sync: a cada 2 min processa 1 clínica com job ativo (harvest + dispara history-sync).
-- Sem job ativo = no-op barato. FOR UPDATE SKIP LOCKED no tick evita sobreposição na mesma clínica.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='onboarding_deep_sync_tick') THEN
    PERFORM cron.unschedule('onboarding_deep_sync_tick');
  END IF;
END $$;
SELECT cron.schedule('onboarding_deep_sync_tick', '*/2 * * * *', 'SELECT public.onboarding_deep_sync_tick(1, 20)');
