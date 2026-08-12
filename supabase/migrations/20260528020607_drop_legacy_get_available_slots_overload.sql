-- 20260528020607_drop_legacy_get_available_slots_overload
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP FUNCTION IF EXISTS public.get_available_slots(uuid, date, uuid);
