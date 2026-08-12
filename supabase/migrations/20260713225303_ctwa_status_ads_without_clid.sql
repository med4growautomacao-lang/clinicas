-- 20260713225303_ctwa_status_ads_without_clid
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

alter table public.lead_tracking_inbox add column if not exists external_id text;

comment on column public.lead_tracking_inbox.external_id is
  'Chave natural do clique: o ctwa_clid quando existe; wa_status:<messageid> para Anúncio no Status, que não gera clid.';

update public.lead_tracking_inbox
   set external_id = ctwa_clid
 where external_id is null and ctwa_clid is not null;

drop index if exists public.lead_tracking_inbox_ctwa_clid_uniq;

create unique index if not exists lead_tracking_inbox_external_id_uniq
  on public.lead_tracking_inbox (clinic_id, external_id)
  where external_id is not null;

create or replace function public.fn_touchpoint_from_ctwa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := coalesce(new.external_id, new.ctwa_clid);
begin
  if v_ref is null then
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
     v_ref,
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

create or replace function public.fn_touchpoint_ctwa_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := coalesce(new.external_id, new.ctwa_clid);
begin
  if new.matched_lead_id is not null and old.matched_lead_id is null and v_ref is not null then
    update public.lead_touchpoints
       set lead_id = new.matched_lead_id
     where channel = 'whatsapp' and external_ref = v_ref and lead_id is null;
  end if;
  return null;
end;
$$;

commit;
