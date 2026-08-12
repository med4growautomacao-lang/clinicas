-- 20260722025038_ad_spend_sync_config_closed_days
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

update public.system_settings
   set value = jsonb_build_object(
         'enabled',           true,
         'every_hours',       24,
         'run_hour_sp',       5,
         'lookback_days',     2,
         'platforms',         jsonb_build_array('meta_ads', 'google_ads'),
         'batch_size',        300,
         'breakdown_enabled', true
       )::text,
       updated_at = now()
 where id = 'ad_spend_sync_config';

insert into public.system_settings (id, value, description)
select 'ad_spend_sync_config',
       jsonb_build_object(
         'enabled',           true,
         'every_hours',       24,
         'run_hour_sp',       5,
         'lookback_days',     2,
         'platforms',         jsonb_build_array('meta_ads', 'google_ads'),
         'batch_size',        300,
         'breakdown_enabled', true
       )::text,
       'Agendador de investimento (Meta+Google): janela, plataformas e detalhamento por campanha.'
where not exists (select 1 from public.system_settings where id = 'ad_spend_sync_config');
