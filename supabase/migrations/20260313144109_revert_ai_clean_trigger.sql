-- 20260313144109_revert_ai_clean_trigger
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Drop the trigger and function to revert changes
DROP TRIGGER IF EXISTS tr_clean_chat_message ON public.chat_messages;
DROP FUNCTION IF EXISTS public.fn_clean_chat_message();
