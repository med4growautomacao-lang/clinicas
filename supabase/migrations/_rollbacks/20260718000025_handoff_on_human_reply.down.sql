-- Rollback de 20260718000025_handoff_on_human_reply.sql
drop trigger if exists trg_handoff_on_human_reply on public.chat_messages;
drop function if exists public.fn_handoff_on_human_reply();
