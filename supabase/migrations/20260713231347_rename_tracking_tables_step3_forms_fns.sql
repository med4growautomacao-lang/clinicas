-- 20260713231347_rename_tracking_tables_step3_forms_fns
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

create or replace function public.fn_touchpoint_from_site_form()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if coalesce(new.capture_channel, '') <> 'forms' then
    return null;
  end if;

  -- Veio do Formulário Nativo do Meta? Então não é "formulário do site".
  if exists (
    select 1 from public.meta_form_submissions lt
    where lt.clinic_id = new.clinic_id
      and lt.channel = 'meta_forms'
      and (
        (nullif(new.rast_id, '') is not null and lt.rast_id = new.rast_id)
        or (lt.phone_norm is not null and lt.phone_norm = normalize_br_phone(new.phone))
      )
  ) then
    return null;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',
     'site_forms', new.source,
     coalesce(new.g_campaign_name, new.fb_campaign_name),
     coalesce(new.g_adset_name,   new.fb_adset_name),
     coalesce(new.g_ad_name,      new.fb_ad_name),
     'Preencheu formulário', new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$function$;

create or replace function public.ingest_meta_form_lead(
  p_clinic_id uuid, p_external_id text, p_name text, p_phone text,
  p_email text default null::text,
  p_submitted_at timestamp with time zone default now(),
  p_campaign_name text default null::text,
  p_adset_name text default null::text,
  p_ad_name text default null::text,
  p_payload jsonb default null::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
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

  -- Ledger / idempotência — barra reprocessamento da mesma submissão (o poller relê a lista 1x/min).
  insert into public.meta_form_submissions (
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
      from public.meta_form_submissions
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

  update public.meta_form_submissions set lead_id = v_lead_id where id = v_track_id;

  return jsonb_build_object('lead_id', v_lead_id, 'created', v_created, 'duplicate', false);
end;
$function$;

commit;
