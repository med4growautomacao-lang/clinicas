-- RASTRO DA CONFIGURACAO DO TIPO DE CONSULTA
-- Motivo (07/08/2026): a cliente perguntou se o intervalo entre consultas "nao tinha sido salvo",
-- e nao houve como responder: consultation_types so tem created_at. Todo numero do periodo
-- anterior foi calculado com o intervalo de HOJE, sem saber se ja foi outro. Sem este rastro a
-- proxima pergunta igual termina em palpite de novo.

alter table public.consultation_types add column if not exists updated_at timestamptz;

create or replace function public.fn_consultation_type_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_consultation_type_touch_updated_at on public.consultation_types;
create trigger trg_consultation_type_touch_updated_at
  before update on public.consultation_types
  for each row execute function public.fn_consultation_type_touch_updated_at();

create table if not exists public.consultation_type_changes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  consultation_type_id uuid not null references public.consultation_types(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  ator text,
  antes jsonb not null,
  depois jsonb not null
);

comment on table public.consultation_type_changes is
  'Historico dos campos que definem a agenda de um tipo de consulta (duracao, passo, intervalos, aviso minimo, ativo, expediente proprio). Nasceu em 07/08/2026: sem ele nao da para responder "quando esse intervalo virou 15 minutos?".';

create index if not exists idx_ct_changes_tipo on public.consultation_type_changes(consultation_type_id, changed_at desc);
create index if not exists idx_ct_changes_clinic on public.consultation_type_changes(clinic_id, changed_at desc);

alter table public.consultation_type_changes enable row level security;

drop policy if exists consultation_type_changes_read on public.consultation_type_changes;
create policy consultation_type_changes_read on public.consultation_type_changes
  for select using (
    clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin())
  );

revoke all on table public.consultation_type_changes from public, anon, authenticated;
grant select on table public.consultation_type_changes to authenticated;

create or replace function public.fn_log_consultation_type_change()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_antes jsonb;
  v_depois jsonb;
begin
  v_antes := jsonb_build_object(
    'consultation_duration', old.consultation_duration, 'slot_step', old.slot_step,
    'buffer_before_minutes', old.buffer_before_minutes, 'buffer_after_minutes', old.buffer_after_minutes,
    'min_notice_minutes', old.min_notice_minutes, 'is_active', old.is_active,
    'name', old.name, 'slug', old.slug, 'working_hours_override', old.working_hours_override);
  v_depois := jsonb_build_object(
    'consultation_duration', new.consultation_duration, 'slot_step', new.slot_step,
    'buffer_before_minutes', new.buffer_before_minutes, 'buffer_after_minutes', new.buffer_after_minutes,
    'min_notice_minutes', new.min_notice_minutes, 'is_active', new.is_active,
    'name', new.name, 'slug', new.slug, 'working_hours_override', new.working_hours_override);

  if v_antes is distinct from v_depois then
    -- Auditoria nunca derruba o salvamento da clinica.
    begin
      insert into public.consultation_type_changes (
        clinic_id, consultation_type_id, changed_by, ator, antes, depois)
      values (
        new.clinic_id, new.id, auth.uid(),
        case when auth.uid() is not null then 'usuario_do_app' else 'sistema' end,
        v_antes, v_depois);
    exception when others then
      perform public.log_system_error(
        'agenda', 'rastro_tipo_consulta_falhou',
        'Nao deu para registrar a alteracao do tipo de consulta (a alteracao em si foi salva)',
        'warn', new.clinic_id,
        jsonb_build_object('consultation_type_id', new.id, 'erro', sqlerrm), false);
    end;
  end if;
  return new;
end; $$;

drop trigger if exists trg_zz_log_consultation_type_change on public.consultation_types;
create trigger trg_zz_log_consultation_type_change
  after update on public.consultation_types
  for each row execute function public.fn_log_consultation_type_change();
