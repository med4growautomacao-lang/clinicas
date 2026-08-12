-- 20260713223231_ctwa_ad_platform_and_inbox_idempotency
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

alter table public.lead_tracking_inbox add column if not exists ad_platform text;
alter table public.leads              add column if not exists ad_platform text;
alter table public.lead_touchpoints   add column if not exists ad_platform text;

comment on column public.leads.ad_platform is
  'Plataforma DENTRO do anúncio pago (instagram/facebook/whatsapp), de externalAdReply.sourceApp. Não confundir com source (origem): um lead pode ser source=meta_ads + ad_platform=instagram.';

create table if not exists public._inbox_dedup_20260713 as
select * from public.lead_tracking_inbox where false;

with ranked as (
  select id, clinic_id, ctwa_clid,
         row_number() over (
           partition by clinic_id, ctwa_clid
           order by (nullif(fb_campaign_name,'') is not null) desc, created_at asc
         ) as rn
  from public.lead_tracking_inbox
  where ctwa_clid is not null
),
mortos as (select id from ranked where rn > 1)
insert into public._inbox_dedup_20260713
select i.* from public.lead_tracking_inbox i join mortos m on m.id = i.id;

delete from public.lead_tracking_inbox i
using public._inbox_dedup_20260713 d
where i.id = d.id;

create unique index if not exists lead_tracking_inbox_ctwa_clid_uniq
  on public.lead_tracking_inbox (clinic_id, ctwa_clid)
  where ctwa_clid is not null;

create or replace function public.fn_apply_inbox_to_lead(p_lead_id uuid, p_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  i public.lead_tracking_inbox%rowtype;
begin
  select * into i from public.lead_tracking_inbox where id = p_inbox_id;
  if not found then return; end if;

  update public.leads l set
    source           = coalesce(nullif(l.source, ''),           nullif(i.source, '')),
    ctwa_clid        = coalesce(nullif(l.ctwa_clid, ''),        nullif(i.ctwa_clid, '')),
    fb_clid          = coalesce(nullif(l.fb_clid, ''),          nullif(i.fb_clid, '')),
    g_clid           = coalesce(nullif(l.g_clid, ''),           nullif(i.g_clid, '')),
    fb_campaign_name = coalesce(nullif(l.fb_campaign_name, ''), nullif(i.fb_campaign_name, '')),
    fb_adset_name    = coalesce(nullif(l.fb_adset_name, ''),    nullif(i.fb_adset_name, '')),
    fb_ad_name       = coalesce(nullif(l.fb_ad_name, ''),       nullif(i.fb_ad_name, '')),
    ad_platform      = coalesce(nullif(l.ad_platform, ''),      nullif(i.ad_platform, '')),
    g_campaign_name  = coalesce(nullif(l.g_campaign_name, ''),  nullif(i.g_campaign_name, '')),
    g_adset_name     = coalesce(nullif(l.g_adset_name, ''),     nullif(i.g_adset_name, '')),
    g_ad_name        = coalesce(nullif(l.g_ad_name, ''),        nullif(i.g_ad_name, '')),
    g_term_name      = coalesce(nullif(l.g_term_name, ''),      nullif(i.g_term_name, '')),
    g_source_name    = coalesce(nullif(l.g_source_name, ''),    nullif(i.g_source_name, '')),
    rast_id          = coalesce(nullif(l.rast_id, ''),          nullif(i.rast_id, ''))
  where l.id = p_lead_id;

  update public.lead_tracking_inbox
     set consumed_at = now(), matched_lead_id = p_lead_id
   where id = p_inbox_id;
end;
$function$;

create or replace function public.fn_touchpoint_from_ctwa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ctwa_clid is null then
    return null;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, occurred_at, channel, source, campaign, adset, ad, ad_platform, detail, external_ref, metadata)
  values
    (new.clinic_id, new.matched_lead_id, new.created_at,
     'whatsapp',
     coalesce(new.source, 'meta_ads'),
     new.fb_campaign_name, new.fb_adset_name, new.fb_ad_name,
     new.ad_platform,
     coalesce(nullif(new.raw->>'ad_title', ''), 'Clique no anúncio'),
     new.ctwa_clid,
     jsonb_strip_nulls(jsonb_build_object(
       'ad_title',  new.raw->>'ad_title',
       'ad_body',   new.raw->>'ad_body',
       'ad_url',    new.raw->>'ad_url',
       'source_id', new.raw->>'source_id'
     )))
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

commit;
