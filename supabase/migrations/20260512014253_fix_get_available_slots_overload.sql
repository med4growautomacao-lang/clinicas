-- 20260512014253_fix_get_available_slots_overload
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove a versão antiga (2 params) deixando só a com 3 params (último opcional)
DROP FUNCTION IF EXISTS public.get_available_slots(uuid, date);
