-- 20260312221707_cleanup_redundant_chat_triggers
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remover gatilhos e funções que agora estão consolidados no handle_chat_message_logic
DROP TRIGGER IF EXISTS tr_handoff_on_message ON public.chat_messages;
DROP FUNCTION IF EXISTS public.handle_handoff_on_message();

-- Remover gatilhos antigos de quando as funções tinham outros nomes
DROP TRIGGER IF EXISTS tr_block_ai_when_disabled ON public.chat_messages;
DROP FUNCTION IF EXISTS public.block_ai_when_disabled();
