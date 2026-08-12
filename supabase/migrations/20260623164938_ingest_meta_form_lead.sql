-- 20260623164938_ingest_meta_form_lead
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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
      p_campaign_name, p_adset_name, p_ad_name, coalesce(p_submitted_at, now())
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
