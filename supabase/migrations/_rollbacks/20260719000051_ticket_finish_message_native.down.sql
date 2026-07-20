-- Rollback do Encerramento nativo. ATENÇÃO: para restaurar o comportamento antigo é preciso
-- (1) reativar o workflow n8n "Encerramento" (VLURxTuLGLb11PMs) e (2) reverter o commit do front
-- que removeu triggerTicketWebhook. Este script só remove o trigger/função nativos.
drop trigger if exists trg_ticket_finish_message on public.tickets;
drop function if exists public.fn_ticket_finish_message();
