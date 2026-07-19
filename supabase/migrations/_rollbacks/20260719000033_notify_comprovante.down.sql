-- Rollback de 20260719000033_notify_comprovante.sql
drop trigger if exists trg_notify_comprovante on public.chat_messages;
drop function if exists public.fn_notify_comprovante();
