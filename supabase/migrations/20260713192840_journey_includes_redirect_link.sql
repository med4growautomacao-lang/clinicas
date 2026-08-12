-- 20260713192840_journey_includes_redirect_link
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- A jornada precisa dizer QUAL link trouxe o toque ("Bio do Instagram", "Story"), não só "veio de um link".
alter table public.lead_touchpoints
  add column if not exists redirect_link_id uuid references public.redirect_links(id) on delete set null;

create index if not exists idx_touchpoints_redirect_link
  on public.lead_touchpoints (redirect_link_id) where redirect_link_id is not null;

-- Backfill dos toques já existentes
update public.lead_touchpoints t
set redirect_link_id = ls.redirect_link_id
from public.link_sessions ls
where t.channel = 'link'
  and t.external_ref = ls.protocolo
  and t.redirect_link_id is null
  and ls.redirect_link_id is not null;

-- Trigger da fonte "link": passa a gravar o link
create or replace function public.fn_touchpoint_from_link_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_source text;
begin
  if new.protocolo is null then
    return null;
  end if;

  select rl.lead_source into v_source from public.redirect_links rl where rl.id = new.redirect_link_id;

  if v_source is null then
    v_source := case when lower(coalesce(new.utm_source,'')) = 'instagram' then 'instagram' else null end;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, detail,
     external_ref, redirect_link_id, metadata)
  values
    (new.clinic_id, new.lead_id, new.rast_id, new.created_at, 'link', v_source,
     new.utm_campaign, coalesce(new.utm_medium, 'link'), new.protocolo, new.redirect_link_id,
     jsonb_build_object('utm_source', new.utm_source, 'utm_content', new.utm_content))
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

-- A RPC devolve o NOME do link para a timeline
drop function if exists public.get_lead_journey(uuid);

create or replace function public.get_lead_journey(p_lead_id uuid)
returns table (
  occurred_at   timestamptz,
  channel       text,
  source        text,
  campaign      text,
  adset         text,
  ad            text,
  detail        text,
  link_name     text,
  is_conversion boolean
)
language sql
stable
security invoker
as $$
  select
    t.occurred_at, t.channel, t.source, t.campaign, t.adset, t.ad, t.detail,
    rl.name as link_name,
    exists (
      select 1 from public.link_sessions ls
      where ls.protocolo = t.external_ref and ls.used_at is not null
    ) or t.channel in ('meta_forms')  as is_conversion
  from public.lead_touchpoints t
  left join public.redirect_links rl on rl.id = t.redirect_link_id
  where t.lead_id = p_lead_id
  order by t.occurred_at asc;
$$;

revoke all on function public.get_lead_journey(uuid) from public, anon;
grant execute on function public.get_lead_journey(uuid) to authenticated;
