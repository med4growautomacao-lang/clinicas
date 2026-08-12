-- 20260618034237_backfill_tyago_instagram_bio_attribution
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Backfill de atribuição: Link de Redirecionamento da bio (Instagram) — clínica Tyago Venâncio
begin;

create table if not exists public._backfill_tyago_instagram_20260618 (
  lead_id              uuid primary key,
  protocolo            text,
  old_source           text,
  old_rast_id          text,
  old_fb_clid          text,
  old_fb_campaign_name text,
  old_fb_adset_name    text,
  old_fb_ad_name       text,
  link_session_id      uuid,
  backed_up_at         timestamptz default now()
);

with prot_msgs as (
  select distinct on (cm.lead_id)
    cm.lead_id,
    (regexp_matches(cm.message->>'content', 'protocolo:?\s*(\d+)', 'i'))[1] as protocolo
  from public.chat_messages cm
  where cm.clinic_id = 'a04a78de-358b-4dcc-9d47-8f02d9a61ef2'
    and cm.message->>'content' ilike '%protocolo%'
    and cm.lead_id is not null
  order by cm.lead_id, cm.created_at asc
),
afetados as (
  select
    l.id as lead_id,
    pm.protocolo,
    l.source, l.rast_id,
    l.fb_clid, l.fb_campaign_name, l.fb_adset_name, l.fb_ad_name,
    (
      select ls.id from public.link_sessions ls
      where ls.rast_id = pm.protocolo
        and ls.clinic_id = l.clinic_id
        and ls.utm_source = 'instagram'
      order by (ls.created_at <= l.created_at) desc,
               abs(extract(epoch from (ls.created_at - l.created_at)))
      limit 1
    ) as link_session_id
  from prot_msgs pm
  join public.leads l on l.id = pm.lead_id
  where exists (
    select 1 from public.link_sessions ls
    where ls.rast_id = pm.protocolo
      and ls.clinic_id = l.clinic_id
      and ls.utm_source = 'instagram'
  )
)
insert into public._backfill_tyago_instagram_20260618
  (lead_id, protocolo, old_source, old_rast_id,
   old_fb_clid, old_fb_campaign_name, old_fb_adset_name, old_fb_ad_name, link_session_id)
select lead_id, protocolo, source, rast_id,
       fb_clid, fb_campaign_name, fb_adset_name, fb_ad_name, link_session_id
from afetados
on conflict (lead_id) do nothing;

update public.leads l
set source           = 'instagram',
    rast_id          = b.protocolo,
    fb_clid          = null,
    fb_campaign_name = null,
    fb_adset_name    = null,
    fb_ad_name       = null
from public._backfill_tyago_instagram_20260618 b
where l.id = b.lead_id;

update public.link_sessions ls
set used_at = l.created_at
from public._backfill_tyago_instagram_20260618 b
join public.leads l on l.id = b.lead_id
where ls.id = b.link_session_id
  and ls.used_at is null;

commit;
