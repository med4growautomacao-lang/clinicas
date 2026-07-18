-- Rollback de 20260718000029_native_confirmation_reply.sql
drop trigger if exists trg_confirmation_reply on public.chat_messages;
drop function if exists public.fn_handle_confirmation_reply();
alter table public.ai_config drop column if exists confirm_native_enabled;
