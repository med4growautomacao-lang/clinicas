-- Rollback. ATENÇÃO: para restaurar o lembrete de confirmação é preciso reativar o n8n
-- "Envio de Confirmação" (g1FIMauq3Ql32Pws). O pós-atendimento não tinha n8n.
select cron.unschedule('confirmation_reminder_job');
select cron.unschedule('pos_followup_job');
drop function if exists public.process_confirmation_reminders();
drop function if exists public.process_pos_followup();
alter table public.tickets drop column if exists pos_followup_sent_at;
