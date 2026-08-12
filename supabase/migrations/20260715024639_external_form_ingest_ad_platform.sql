-- 20260715024639_external_form_ingest_ad_platform
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Posicionamento (utm_medium) não tem coluna própria, mas a PLATAFORMA que ele carrega
-- (Facebook_Mobile_Reels -> facebook, Instagram_Reels -> instagram) encaixa no enum já existente
-- leads.ad_platform (hoje só o CTWA preenche: instagram/facebook/whatsapp). Reaproveitamos essa coluna.

DROP FUNCTION IF EXISTS public.ingest_external_form_lead(uuid,text,text,text,text,text,text,text,text,text,jsonb);

CREATE OR REPLACE FUNCTION public.ingest_external_form_lead(
  p_clinic_id   uuid,
  p_name        text,
  p_phone       text,
  p_email       text DEFAULT NULL,
  p_source      text DEFAULT NULL,   -- google_ads/meta_ads/instagram ou NULL = orgânico
  p_campaign    text DEFAULT NULL,
  p_adset       text DEFAULT NULL,
  p_ad          text DEFAULT NULL,
  p_term        text DEFAULT NULL,
  p_utm_source  text DEFAULT NULL,
  p_ad_platform text DEFAULT NULL,   -- derivado do utm_medium na edge (facebook/instagram)
  p_raw         jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_id    uuid;
  v_lead_id   uuid;
  v_nphone    text;
  v_created   boolean := false;
  v_is_google boolean := (p_source = 'google_ads');
  v_is_meta   boolean := (p_source IN ('meta_ads','instagram'));
BEGIN
  INSERT INTO public.external_form_submissions
    (clinic_id, name, phone, email, source, campaign, adset, ad, term, utm_source, raw)
  VALUES
    (p_clinic_id, p_name, p_phone, p_email, p_source, p_campaign, p_adset, p_ad, p_term, p_utm_source, p_raw)
  RETURNING id INTO v_sub_id;

  IF COALESCE(NULLIF(trim(p_phone), ''), NULLIF(trim(p_email), '')) IS NULL THEN
    RETURN jsonb_build_object('error', 'sem_identidade', 'submission_id', v_sub_id);
  END IF;

  v_nphone := normalize_br_phone(p_phone);

  INSERT INTO public.leads (
    clinic_id, name, phone, email, source, capture_channel, ad_platform,
    g_campaign_name, g_adset_name, g_ad_name, g_term_name,
    fb_campaign_name, fb_adset_name, fb_ad_name
  ) VALUES (
    p_clinic_id,
    COALESCE(NULLIF(trim(p_name), ''), 'Lead'),
    COALESCE(v_nphone, NULLIF(trim(p_phone), '')),
    NULLIF(trim(p_email), ''),
    p_source,
    'forms',
    NULLIF(trim(p_ad_platform), ''),
    CASE WHEN v_is_google THEN p_campaign END,
    CASE WHEN v_is_google THEN p_adset    END,
    CASE WHEN v_is_google THEN p_ad       END,
    CASE WHEN v_is_google THEN p_term     END,
    CASE WHEN v_is_meta   THEN p_campaign END,
    CASE WHEN v_is_meta   THEN p_adset    END,
    CASE WHEN v_is_meta   THEN p_ad       END
  )
  RETURNING id INTO v_lead_id;

  IF v_lead_id IS NULL THEN
    IF v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
      SELECT id INTO v_lead_id FROM public.leads
       WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone
       LIMIT 1;
    END IF;
    v_created := false;
  ELSE
    v_created := true;
  END IF;

  UPDATE public.external_form_submissions SET lead_id = v_lead_id WHERE id = v_sub_id;

  RETURN jsonb_build_object('lead_id', v_lead_id, 'created', v_created, 'submission_id', v_sub_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_external_form_lead(uuid,text,text,text,text,text,text,text,text,text,text,jsonb) FROM anon;

-- Touchpoint do site_form passa a carregar ad_platform (additivo: hoje é NULL p/ quem não seta;
-- só os leads de forms externo que derivam a plataforma passam a preencher).
CREATE OR REPLACE FUNCTION public.fn_touchpoint_from_site_form()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(new.capture_channel, '') <> 'forms' then
    return null;
  end if;

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
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, ad_platform, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',
     'site_forms', new.source,
     coalesce(new.g_campaign_name, new.fb_campaign_name),
     coalesce(new.g_adset_name,   new.fb_adset_name),
     coalesce(new.g_ad_name,      new.fb_ad_name),
     new.ad_platform,
     'Preencheu formulário', new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$function$;
