-- 20260713164053_close_redirect_protocol_trigger
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

alter table public.link_sessions
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

create index if not exists idx_link_sessions_lead_id
  on public.link_sessions (lead_id) where lead_id is not null;

create index if not exists idx_link_sessions_open
  on public.link_sessions (clinic_id, rast_id) where used_at is null;

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

  v_source := case
                when lower(coalesce(v_session.utm_source, '')) = 'instagram' then 'instagram'
                else null
              end;

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

drop trigger if exists trg_close_redirect_protocol on public.chat_messages;
create trigger trg_close_redirect_protocol
  after insert on public.chat_messages
  for each row
  execute function public.fn_close_redirect_protocol();
