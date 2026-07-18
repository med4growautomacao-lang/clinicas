-- Rollback de 20260718000027_notify_appointment_events.sql
drop trigger if exists trg_zz_notify_appointment_event on public.appointments;
drop function if exists public.fn_notify_appointment_event();
