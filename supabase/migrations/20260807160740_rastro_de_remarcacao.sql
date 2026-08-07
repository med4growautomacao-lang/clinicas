-- RASTRO DE REMARCACAO
-- Motivo (07/08/2026): a apuracao do buffer da Lorena travou numa pergunta simples, "quando essa
-- consulta virou 18:45?", e nao teve resposta: appointments nao guarda data de alteracao nem
-- historico. reschedule_appointment troca date/time sem tocar created_at, entao "criado antes do
-- fix" nao quer dizer "horario decidido antes do fix". Sem este rastro, toda apuracao futura de
-- agenda termina em palpite.

alter table public.appointments add column if not exists updated_at timestamptz;

create or replace function public.fn_appointment_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_appointment_touch_updated_at on public.appointments;
create trigger trg_appointment_touch_updated_at
  before update on public.appointments
  for each row execute function public.fn_appointment_touch_updated_at();

create table if not exists public.appointment_changes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  ator text,
  old_date date, new_date date,
  old_time time, new_time time,
  old_doctor_id uuid, new_doctor_id uuid,
  old_status text, new_status text,
  forcado boolean not null default false
);

comment on table public.appointment_changes is
  'Historico de remarcacao/cancelamento de consulta. Nasceu em 07/08/2026 porque appointments nao guardava data de alteracao e a pergunta "quando esse horario mudou?" ficava sem resposta. So grava quando data, hora, medico ou status mudam de verdade.';
comment on column public.appointment_changes.forcado is
  'true = encaixe da recepcao (reschedule_appointment com p_force), que pula a validacao de disponibilidade de proposito. E o unico caminho que produz consulta colada hoje.';

create index if not exists idx_appointment_changes_appt on public.appointment_changes(appointment_id, changed_at desc);
create index if not exists idx_appointment_changes_clinic on public.appointment_changes(clinic_id, changed_at desc);

alter table public.appointment_changes enable row level security;

drop policy if exists appointment_changes_read on public.appointment_changes;
create policy appointment_changes_read on public.appointment_changes
  for select using (
    clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin())
  );

revoke all on table public.appointment_changes from public, anon, authenticated;
grant select on table public.appointment_changes to authenticated;

create or replace function public.fn_log_appointment_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (new.date is distinct from old.date)
     or (new.time is distinct from old.time)
     or (new.doctor_id is distinct from old.doctor_id)
     or (new.status is distinct from old.status) then
    -- Auditoria NUNCA pode derrubar um agendamento. Se esta gravacao falhar, a consulta continua
    -- valendo e o erro vai para a Central, nao para a cara do paciente.
    begin
      insert into public.appointment_changes (
        clinic_id, appointment_id, changed_by, ator,
        old_date, new_date, old_time, new_time,
        old_doctor_id, new_doctor_id, old_status, new_status, forcado)
      values (
        new.clinic_id, new.id, auth.uid(),
        case when auth.uid() is not null then 'usuario_do_app' else 'sistema' end,
        old.date, new.date, old.time, new.time,
        old.doctor_id, new.doctor_id, old.status, new.status,
        coalesce(current_setting('app.appt_force', true), '') = '1');
    exception when others then
      perform public.log_system_error(
        'agenda', 'rastro_remarcacao_falhou',
        'Nao deu para registrar a alteracao de uma consulta (o agendamento em si foi salvo)',
        'warn', new.clinic_id,
        jsonb_build_object('appointment_id', new.id, 'erro', sqlerrm), false);
    end;
  end if;
  return new;
end; $$;

drop trigger if exists trg_zz_log_appointment_change on public.appointments;
create trigger trg_zz_log_appointment_change
  after update on public.appointments
  for each row execute function public.fn_log_appointment_change();
