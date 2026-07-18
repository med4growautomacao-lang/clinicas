-- Rollback de 20260718000028_confirm_reply_messages.sql
alter table public.ai_config drop column if exists confirm_reply_remarcado;
alter table public.ai_config drop column if exists confirm_reply_cancelado;
