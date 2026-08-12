-- 20260610031838_drop_stale_functions
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP FUNCTION IF EXISTS public.handle_chat_message_lead_capture();
DROP FUNCTION IF EXISTS public.handle_chat_message_logic();
DROP FUNCTION IF EXISTS public.fn_log_lead_stage_change();
DROP FUNCTION IF EXISTS public.fn_set_default_lead_stage();

DROP TRIGGER IF EXISTS tr_sanitize_lead_phone ON public.leads;
DROP FUNCTION IF EXISTS public.sanitize_lead_phone_number();
