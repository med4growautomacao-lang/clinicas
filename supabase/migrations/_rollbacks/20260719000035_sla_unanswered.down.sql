-- Rollback de 20260719000035_sla_unanswered.sql
do $$ begin perform cron.unschedule('sla_unanswered_job'); exception when others then null; end $$;
drop function if exists public.process_sla_unanswered(integer);
alter table public.leads drop column if exists sla_alerted_at;
