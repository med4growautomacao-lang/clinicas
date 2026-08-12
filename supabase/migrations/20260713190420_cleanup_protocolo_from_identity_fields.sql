-- 20260713190420_cleanup_protocolo_from_identity_fields
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

alter table public.link_sessions alter column rast_id drop not null;

update public.link_sessions
set rast_id = null
where rast_id is not null
  and rast_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

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
  where ls.protocolo = v_proto
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
  set source  = coalesce(nullif(l.source, ''), v_source),
      rast_id = case
                  when nullif(v_session.rast_id, '') is null then l.rast_id
                  when nullif(l.rast_id, '') is null then v_session.rast_id
                  when l.capture_channel = 'whatsapp'
                       and not exists (
                         select 1 from public.link_sessions s
                          where s.rast_id = l.rast_id and s.id <> v_session.id
                       )
                    then v_session.rast_id
                  else l.rast_id
                end
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

create table if not exists public._fix_leads_rast_id_protocolo_20260713 (
  lead_id      uuid primary key,
  old_rast_id  text,
  new_rast_id  text,
  fixed_at     timestamptz default now()
);

with alvos as (
  select id as lead_id, rast_id as old_rast_id, gen_random_uuid()::text as new_rast_id
  from public.leads
  where rast_id ~ '^\d{3,6}$'
)
insert into public._fix_leads_rast_id_protocolo_20260713 (lead_id, old_rast_id, new_rast_id)
select lead_id, old_rast_id, new_rast_id from alvos
on conflict (lead_id) do nothing;

update public.leads l
set rast_id = f.new_rast_id
from public._fix_leads_rast_id_protocolo_20260713 f
where l.id = f.lead_id;
