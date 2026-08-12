-- 20260720190755_meta_capi_revoke_trigger_fn
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

REVOKE ALL ON FUNCTION public.fn_enqueue_meta_capi_event() FROM PUBLIC, anon, authenticated;
