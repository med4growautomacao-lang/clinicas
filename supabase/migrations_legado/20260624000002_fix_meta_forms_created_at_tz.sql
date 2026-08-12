-- Corrige o fuso do created_at dos leads do Formulário Meta.
--
-- Bug: ingest_meta_form_lead gravava leads.created_at = p_submitted_at (timestamptz em UTC) numa
-- coluna `timestamp without time zone` cuja convenção no projeto é horário de São Paulo. Com a
-- sessão em UTC, o wall-clock UTC era gravado como se fosse SP → created_at ~3h adiantado. Isso
-- atrasava o gate de delay do welcome e deslocava os painéis que contam por created_at.
--
-- Fix: converter o timestamptz para o wall-clock de São Paulo (AT TIME ZONE 'America/Sao_Paulo').
-- lead_tracking.submitted_at é timestamptz (correto) e fica como está.

create or replace function public.ingest_meta_form_lead(
  p_clinic_id     uuid,
  p_external_id   text,
  p_name          text,
  p_phone         text,
  p_email         text        default null,
  p_submitted_at  timestamptz default now(),
  p_campaign_name text        default null,
  p_adset_name    text        default null,
  p_ad_name       text        default null,
  p_payload       jsonb       default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_track_id uuid;
  v_lead_id  uuid;
  v_nphone   text;
  v_rast     text;
  v_created  boolean := false;
  v_created_sp timestamp := coalesce(
    (p_submitted_at AT TIME ZONE 'America/Sao_Paulo'),
    (now() AT TIME ZONE 'America/Sao_Paulo')
  );
begin
  if p_external_id is null or p_external_id = '' then
    return jsonb_build_object('error', 'external_id obrigatório');
  end if;

  v_nphone := normalize_br_phone(p_phone);

  insert into public.lead_tracking (
    clinic_id, channel, external_id, name, phone, email,
    source, fb_campaign_name, fb_adset_name, fb_ad_name, submitted_at, payload
  ) values (
    p_clinic_id, 'meta_forms', p_external_id, p_name, p_phone, p_email,
    'meta_ads', p_campaign_name, p_adset_name, p_ad_name, coalesce(p_submitted_at, now()), p_payload
  )
  on conflict (channel, external_id) do nothing
  returning id into v_track_id;

  if v_track_id is null then
    select lead_id into v_lead_id
      from public.lead_tracking
     where channel = 'meta_forms' and external_id = p_external_id;
    return jsonb_build_object('lead_id', v_lead_id, 'created', false, 'duplicate', true);
  end if;

  if v_nphone is not null and length(v_nphone) >= 12 then
    select id into v_lead_id
      from public.leads
     where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_nphone
     limit 1;
  end if;

  if v_lead_id is null then
    v_rast := gen_random_uuid()::text;
    insert into public.leads (
      clinic_id, name, phone, email, source, capture_channel, rast_id,
      fb_campaign_name, fb_adset_name, fb_ad_name, created_at
    ) values (
      p_clinic_id, coalesce(nullif(p_name, ''), 'Lead Meta'), coalesce(v_nphone, p_phone), p_email,
      'meta_ads', 'forms', v_rast,
      p_campaign_name, p_adset_name, p_ad_name, v_created_sp
    )
    returning id into v_lead_id;

    if v_lead_id is null and v_nphone is not null then
      select id into v_lead_id
        from public.leads
       where clinic_id = p_clinic_id and normalize_br_phone(phone) = v_nphone
       limit 1;
    else
      v_created := true;
    end if;
  else
    update public.leads set
      source           = coalesce(nullif(source, ''),           'meta_ads'),
      fb_campaign_name = coalesce(nullif(fb_campaign_name, ''),  nullif(p_campaign_name, '')),
      fb_adset_name    = coalesce(nullif(fb_adset_name, ''),     nullif(p_adset_name, '')),
      fb_ad_name       = coalesce(nullif(fb_ad_name, ''),        nullif(p_ad_name, '')),
      email            = coalesce(nullif(email, ''),             nullif(p_email, ''))
    where id = v_lead_id;
  end if;

  update public.lead_tracking set lead_id = v_lead_id where id = v_track_id;

  return jsonb_build_object('lead_id', v_lead_id, 'created', v_created, 'duplicate', false);
end;
$$;

-- Backfill: corrige created_at dos leads de meta_forms já criados (usa submitted_at do tracking).
UPDATE public.leads l
SET created_at = (lt.submitted_at AT TIME ZONE 'America/Sao_Paulo')
FROM public.lead_tracking lt
WHERE lt.channel = 'meta_forms'
  AND lt.lead_id = l.id
  AND lt.submitted_at IS NOT NULL
  AND l.created_at IS DISTINCT FROM (lt.submitted_at AT TIME ZONE 'America/Sao_Paulo');
