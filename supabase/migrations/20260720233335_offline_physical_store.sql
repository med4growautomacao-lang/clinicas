-- 20260720233335_offline_physical_store
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

update public.system_settings
   set value = (coalesce(value::jsonb,'{}'::jsonb) || '{"offline_action_source":"physical_store"}'::jsonb)::text,
       updated_at = now()
 where id = 'meta_capi_config';
