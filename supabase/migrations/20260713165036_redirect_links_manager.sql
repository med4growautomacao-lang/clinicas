-- 20260713165036_redirect_links_manager
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create table if not exists public.redirect_links (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  name         text not null,
  code         text not null unique,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_content  text,
  utm_term     text,
  lead_source  text check (lead_source is null or lead_source in ('instagram','meta_ads','google_ads')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  archived_at  timestamptz
);

create index if not exists idx_redirect_links_clinic on public.redirect_links (clinic_id) where archived_at is null;

alter table public.link_sessions
  add column if not exists redirect_link_id uuid references public.redirect_links(id) on delete set null;

create index if not exists idx_link_sessions_redirect_link
  on public.link_sessions (redirect_link_id) where redirect_link_id is not null;

alter table public.redirect_links enable row level security;

drop policy if exists redirect_links_access on public.redirect_links;
create policy redirect_links_access on public.redirect_links
  for all
  using (
    (clinic_id in (select clinic_users.clinic_id from clinic_users where clinic_users.id = auth.uid())
      and is_clinic_active(clinic_id))
    or (clinic_id in (select c.id from clinics c join org_users ou on ou.organization_id = c.organization_id
                       where ou.user_id = auth.uid()))
    or is_clinic_admin(clinic_id)
  )
  with check (
    (clinic_id in (select clinic_users.clinic_id from clinic_users where clinic_users.id = auth.uid())
      and is_clinic_active(clinic_id))
    or (clinic_id in (select c.id from clinics c join org_users ou on ou.organization_id = c.organization_id
                       where ou.user_id = auth.uid()))
    or is_clinic_admin(clinic_id)
  );

create or replace function public.fn_gen_redirect_code()
returns text
language plpgsql
as $$
declare
  v_alphabet constant text := 'abcdefghijkmnopqrstuvwxyz23456789';
  v_code text;
  i int;
begin
  for attempt in 1..20 loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    if not exists (select 1 from public.redirect_links where code = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'nao foi possivel gerar um codigo unico para o link';
end;
$$;

create or replace function public.get_redirect_link_stats(p_clinic_id uuid)
returns table (
  id           uuid,
  name         text,
  code         text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  lead_source  text,
  active       boolean,
  archived_at  timestamptz,
  created_at   timestamptz,
  cliques      bigint,
  leads        bigint,
  conversoes   bigint,
  ultimo_clique timestamptz
)
language sql
stable
security invoker
as $$
  select
    rl.id, rl.name, rl.code, rl.utm_source, rl.utm_medium, rl.utm_campaign,
    rl.lead_source, rl.active, rl.archived_at, rl.created_at,
    count(ls.id)                                              as cliques,
    count(distinct ls.lead_id)                                as leads,
    count(distinct l.id) filter (where l.converted_patient_id is not null) as conversoes,
    max(ls.created_at)                                        as ultimo_clique
  from public.redirect_links rl
  left join public.link_sessions ls on ls.redirect_link_id = rl.id
  left join public.leads l on l.id = ls.lead_id
  where rl.clinic_id = p_clinic_id
  group by rl.id
  order by rl.archived_at nulls first, rl.created_at desc;
$$;

revoke all on function public.get_redirect_link_stats(uuid) from public, anon;
grant execute on function public.get_redirect_link_stats(uuid) to authenticated;

create or replace function public.fn_close_redirect_protocol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proto   text;
  v_session public.link_sessions%rowtype;
  v_source  text;
begin
  if new.direction is distinct from 'inbound' or new.lead_id is null then
    return new;
  end if;

  v_proto := (regexp_match(coalesce(new.message->>'content', ''), '[Pp]rotocolo:?\s*(\d+)'))[1];
  if v_proto is null then
    return new;
  end if;

  select * into v_session
  from public.link_sessions ls
  where ls.rast_id = v_proto
    and ls.clinic_id = new.clinic_id
    and ls.used_at is null
    and ls.created_at > now() - interval '30 days'
  limit 1;

  if not found then
    return new;
  end if;

  select rl.lead_source into v_source
  from public.redirect_links rl
  where rl.id = v_session.redirect_link_id;

  if v_source is null then
    v_source := case
                  when lower(coalesce(v_session.utm_source, '')) = 'instagram' then 'instagram'
                  else null
                end;
  end if;

  update public.leads l
  set rast_id = coalesce(l.rast_id, v_session.rast_id),
      source  = coalesce(nullif(l.source, ''), v_source)
  where l.id = new.lead_id
    and l.ctwa_clid is null
    and l.fb_clid   is null
    and l.g_clid    is null;

  update public.link_sessions
  set used_at = now(),
      lead_id = new.lead_id
  where id = v_session.id
    and used_at is null;

  return new;
end;
$$;
