-- WhatsApp zombie recovery via pg_cron
--
-- Why: tentativas que ficam presas em 'connecting' sem progresso (sem evento da
-- uazapi, sem QR escaneado) precisam ser zeradas automaticamente. O QR da uazapi
-- expira em 2 minutos; damos 3 minutos de tolerância antes de marcar como
-- disconnected. Sem isso, instâncias zumbis impedem novas tentativas (state
-- machine não permite 'connecting -> connecting' indireto).

begin;

create or replace function public.recover_whatsapp_zombies()
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

-- Remove job anterior se existir (idempotente)
do $$
begin
  perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'whatsapp_zombie_recovery';
exception
  when others then null;
end $$;

-- Agenda a cada 1 minuto
select cron.schedule(
  'whatsapp_zombie_recovery',
  '* * * * *',
  $cmd$ select public.recover_whatsapp_zombies(); $cmd$
);

commit;
