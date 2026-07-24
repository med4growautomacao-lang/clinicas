-- Rollback do schema do Lembrete de Consulta. Rodar DEPOIS do rollback do motor
-- (20260723235500_appt_reminder_engine.down.sql), que remove o cron e as funções que leem estas
-- colunas. Aqui só cai o trigger de re-arme e as colunas.
drop trigger if exists trg_appt_rearm_reminder on public.appointments;
drop function if exists public.fn_appt_rearm_reminder();

alter table public.appointments
  drop column if exists appt_reminder_sent_at,
  drop column if exists appt_reminder_expired_at;

alter table public.ai_config
  drop column if exists appt_reminder_enabled,
  drop column if exists appt_reminder_message,
  drop column if exists appt_reminder_lead_time,
  drop column if exists appt_reminder_window_start,
  drop column if exists appt_reminder_window_end,
  drop column if exists appt_reminder_grace_minutes,
  drop column if exists appt_reminder_only_confirmed;
