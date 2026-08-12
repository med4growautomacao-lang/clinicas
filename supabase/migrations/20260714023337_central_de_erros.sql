-- 20260714023337_central_de_erros
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

create table if not exists public.system_errors (
  id             uuid primary key default gen_random_uuid(),
  fingerprint    text not null unique,
  scope          text not null,
  code           text not null,
  level          text not null default 'error',
  title          text not null,
  clinic_id      uuid references public.clinics(id) on delete set null,
  is_monitor     boolean not null default false,
  occurrences    integer not null default 1,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  status         text not null default 'open',
  resolved_at    timestamptz,
  last_context   jsonb,
  constraint system_errors_level_chk  check (level  in ('warn','error','critical')),
  constraint system_errors_status_chk check (status in ('open','ack','resolved'))
);

create index if not exists system_errors_status_idx on public.system_errors (status, level, last_seen_at desc);
create index if not exists system_errors_clinic_idx on public.system_errors (clinic_id);

comment on table public.system_errors is
  'Central de Erros: falhas e condições anômalas de todo o sistema (edge functions, crons, invariantes de domínio), agregadas por fingerprint. Visível só para super admin.';

create or replace function public.log_system_error(
  p_scope      text,
  p_code       text,
  p_title      text,
  p_level      text    default 'error',
  p_clinic_id  uuid    default null,
  p_context    jsonb   default null,
  p_is_monitor boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_fp text;
  v_id uuid;
begin
  -- A clínica entra no fingerprint DE PROPÓSITO: "token bloqueado" é um problema por clínica, e
  -- juntar todas numa linha só esconderia quantas estão afetadas.
  v_fp := md5(p_scope || '|' || p_code || '|' || coalesce(p_clinic_id::text, '-'));

  insert into public.system_errors as e (
    fingerprint, scope, code, level, title, clinic_id, is_monitor, last_context
  ) values (
    v_fp, p_scope, p_code, coalesce(p_level, 'error'), p_title, p_clinic_id,
    coalesce(p_is_monitor, false), p_context
  )
  on conflict (fingerprint) do update set
    occurrences  = e.occurrences + 1,
    last_seen_at = now(),
    title        = excluded.title,
    level        = excluded.level,
    last_context = coalesce(excluded.last_context, e.last_context),
    status       = case when e.status = 'resolved' then 'open' else e.status end,
    resolved_at  = case when e.status = 'resolved' then null  else e.resolved_at end
  returning e.id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.log_system_error(text, text, text, text, uuid, jsonb, boolean) from public, anon;
grant execute on function public.log_system_error(text, text, text, text, uuid, jsonb, boolean) to service_role;

alter table public.system_errors enable row level security;

drop policy if exists system_errors_super_admin_all on public.system_errors;
create policy system_errors_super_admin_all on public.system_errors
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select, update on public.system_errors to authenticated;

commit;
