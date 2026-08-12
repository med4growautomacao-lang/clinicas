-- 20260601163401_whatsapp_zombie_recovery
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

create or replace function public.recover_whatsapp_zombies()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row record;
begin
  for v_row in
    select id, clinic_id, attempt_id
    from public.whatsapp_instances
    where status = 'connecting'
      and attempt_started_at is not null
      and attempt_started_at < now() - interval '3 minutes'
  loop
    update public.whatsapp_instances
       set status = 'disconnected',
           last_error = 'zombie_recovery: sem evento da uazapi por mais de 3 minutos'
     where id = v_row.id;

    insert into public.whatsapp_events (clinic_id, instance_id, attempt_id, event_type, source, payload)
    values (v_row.clinic_id, v_row.id, v_row.attempt_id, 'timeout', 'cron',
            jsonb_build_object('reason','attempt_exceeded_3min'));
  end loop;
end;
$fn$;

do $cleanup$
begin
  perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'whatsapp_zombie_recovery';
exception
  when others then null;
end $cleanup$;

select cron.schedule(
  'whatsapp_zombie_recovery',
  '* * * * *',
  'select public.recover_whatsapp_zombies();'
);

commit;
