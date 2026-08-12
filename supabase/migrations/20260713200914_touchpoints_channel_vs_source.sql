-- 20260713200914_touchpoints_channel_vs_source
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

update public.lead_touchpoints set channel = 'whatsapp' where channel = 'meta_ads';
update public.lead_touchpoints set channel = 'whatsapp' where channel = 'link';

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
    (new.clinic_id, new.lead_id, new.rast_id, new.created_at,
     'whatsapp', v_source,
     new.utm_campaign, coalesce(new.utm_medium, 'link'), new.protocolo, new.redirect_link_id,
     jsonb_build_object('utm_source', new.utm_source, 'utm_content', new.utm_content))
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

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
    (clinic_id, lead_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.matched_lead_id, new.created_at,
     'whatsapp', coalesce(new.source, 'meta_ads'),
     new.fb_campaign_name, new.fb_adset_name, new.fb_ad_name,
     'Clique no anúncio', new.ctwa_clid)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

create or replace function public.fn_touchpoint_link_session_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null and old.lead_id is null then
    update public.lead_touchpoints
    set lead_id = new.lead_id
    where channel = 'whatsapp' and external_ref = new.protocolo and lead_id is null;
  end if;
  return null;
end;
$$;

create or replace function public.fn_touchpoint_ctwa_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.matched_lead_id is not null and old.matched_lead_id is null and new.ctwa_clid is not null then
    update public.lead_touchpoints
    set lead_id = new.matched_lead_id
    where channel = 'whatsapp' and external_ref = new.ctwa_clid and lead_id is null;
  end if;
  return null;
end;
$$;

create or replace function public.fn_touchpoint_from_direct_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel text;
  v_detail  text;
begin
  v_channel := coalesce(new.capture_channel, 'whatsapp');

  if v_channel = 'forms' then
    return null;
  end if;

  if nullif(new.ctwa_clid,'') is not null
     or nullif(new.fb_clid,'') is not null
     or nullif(new.g_clid,'') is not null then
    return null;
  end if;

  v_detail := case v_channel
                when 'balcao' then 'Atendimento no balcão'
                when 'manual' then 'Cadastro manual'
                else 'Mandou mensagem no WhatsApp'
              end;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',
     v_channel, new.source,
     coalesce(new.fb_campaign_name, new.g_campaign_name),
     coalesce(new.fb_adset_name,    new.g_adset_name),
     coalesce(new.fb_ad_name,       new.g_ad_name),
     v_detail, new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

drop trigger if exists trg_touchpoint_direct_contact on public.leads;
create trigger trg_touchpoint_direct_contact
  after insert on public.leads
  for each row execute function public.fn_touchpoint_from_direct_contact();
