-- 20260725031415_20260725001342_ingest_ids_accept_prefixed_names
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- ingest_external_form_lead: aceita as DUAS convenções de nome dos IDs vindas do formulário —
-- sem prefixo (campaign_id/adset_id/ad_id, form de produção 5b85d1a) e com prefixo de rede
-- (fb_*/g_*, usado noutros forms). Antes só lia a versão sem prefixo e o ID chegava mas era
-- IGNORADO (visto no "teste 11": fb_adset_id no raw, lead gravado sem adset_id).
-- Bônus: o prefixo é sinal de REDE — quando o param vem como fb_*/g_* o roteamento segue esse
-- prefixo mesmo se a origem não foi detectada (utm_source "direto" etc.), em vez de cair no
-- ramo Google por omissão.
create or replace function public.ingest_external_form_lead(
  p_clinic_id uuid, p_name text, p_phone text, p_email text default null,
  p_source text default null, p_campaign text default null, p_adset text default null,
  p_ad text default null, p_term text default null, p_utm_source text default null,
  p_ad_platform text default null, p_raw jsonb default null,
  p_g_clid text default null, p_fb_clid text default null, p_rast_id text default null,
  p_campaign_id text default null, p_adset_id text default null, p_ad_id text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_sub_id  uuid;
  v_lead_id uuid;
  v_nphone  text;
  v_created boolean := false;
  v_is_meta boolean := (p_source IN ('meta_ads','instagram'));
  -- IDs com prefixo explícito de rede (sinal forte de plataforma)
  v_fb_c text := NULLIF(trim(p_raw->>'fb_campaign_id'), '');
  v_fb_s text := NULLIF(trim(p_raw->>'fb_adset_id'), '');
  v_fb_a text := NULLIF(trim(p_raw->>'fb_ad_id'), '');
  v_g_c  text := NULLIF(trim(p_raw->>'g_campaign_id'), '');
  v_g_s  text := NULLIF(trim(p_raw->>'g_adset_id'), '');
  v_g_a  text := NULLIF(trim(p_raw->>'g_ad_id'), '');
  v_campaign_id text;
  v_adset_id    text;
  v_ad_id       text;
  v_id_rede     text;  -- 'meta' | 'google' | null  (rede indicada pelo PREFIXO do param)
BEGIN
  -- Ordem: param explícito > sem prefixo > fb_* > g_* > utm_id (só campanha).
  v_campaign_id := COALESCE(NULLIF(trim(p_campaign_id), ''), NULLIF(trim(p_raw->>'campaign_id'), ''),
                            v_fb_c, v_g_c, NULLIF(trim(p_raw->>'utm_id'), ''));
  v_adset_id    := COALESCE(NULLIF(trim(p_adset_id), ''),    NULLIF(trim(p_raw->>'adset_id'), ''),
                            v_fb_s, v_g_s);
  v_ad_id       := COALESCE(NULLIF(trim(p_ad_id), ''),       NULLIF(trim(p_raw->>'ad_id'), ''),
                            v_fb_a, v_g_a);

  IF COALESCE(v_fb_c, v_fb_s, v_fb_a) IS NOT NULL THEN
    v_id_rede := 'meta';
  ELSIF COALESCE(v_g_c, v_g_s, v_g_a) IS NOT NULL THEN
    v_id_rede := 'google';
  END IF;

  -- Prefixo do param manda; sem prefixo, segue a origem do lead.
  IF v_id_rede = 'meta' THEN v_is_meta := true;
  ELSIF v_id_rede = 'google' THEN v_is_meta := false;
  END IF;

  INSERT INTO public.external_form_submissions
    (clinic_id, name, phone, email, source, campaign, adset, ad, term, utm_source, raw)
  VALUES
    (p_clinic_id, p_name, p_phone, p_email, p_source, p_campaign, p_adset, p_ad, p_term, p_utm_source, p_raw)
  RETURNING id INTO v_sub_id;

  IF COALESCE(NULLIF(trim(p_phone), ''), NULLIF(trim(p_email), '')) IS NULL THEN
    RETURN jsonb_build_object('error', 'sem_identidade', 'submission_id', v_sub_id);
  END IF;

  v_nphone := normalize_br_phone(p_phone);

  IF NULLIF(trim(p_phone), '') IS NOT NULL AND (v_nphone IS NULL OR length(v_nphone) < 12) THEN
    PERFORM log_system_error(
      'external_forms', 'FORM_PHONE_SEM_DDD',
      'Formulário recebido com telefone sem DDD — lead não criado',
      'warning', p_clinic_id,
      jsonb_build_object('submission_id', v_sub_id, 'phone_recebido', p_phone,
                         'phone_normalizado', v_nphone, 'nome', p_name, 'source', p_source),
      false
    );
    RETURN jsonb_build_object('error', 'telefone_sem_ddd', 'submission_id', v_sub_id,
                              'phone', p_phone);
  END IF;

  INSERT INTO public.leads (
    clinic_id, name, phone, email, source, capture_channel, ad_platform,
    g_clid, fb_clid, rast_id,
    g_campaign_name, g_adset_name, g_ad_name, g_term_name, g_source_name,
    fb_campaign_name, fb_adset_name, fb_ad_name,
    g_campaign_id, g_adset_id, g_ad_id,
    fb_campaign_id, fb_adset_id, fb_ad_id
  ) VALUES (
    p_clinic_id,
    COALESCE(NULLIF(trim(p_name), ''), 'Lead'),
    COALESCE(v_nphone, NULLIF(trim(p_phone), '')),
    NULLIF(trim(p_email), ''),
    p_source,
    'forms',
    NULLIF(trim(p_ad_platform), ''),
    NULLIF(trim(p_g_clid), ''),
    NULLIF(trim(p_fb_clid), ''),
    NULLIF(trim(p_rast_id), ''),
    CASE WHEN NOT (p_source IN ('meta_ads','instagram')) THEN p_campaign END,
    CASE WHEN NOT (p_source IN ('meta_ads','instagram')) THEN p_adset END,
    CASE WHEN NOT (p_source IN ('meta_ads','instagram')) THEN p_ad END,
    CASE WHEN NOT (p_source IN ('meta_ads','instagram')) THEN p_term END,
    NULLIF(trim(p_utm_source), ''),
    CASE WHEN (p_source IN ('meta_ads','instagram')) THEN p_campaign END,
    CASE WHEN (p_source IN ('meta_ads','instagram')) THEN p_adset END,
    CASE WHEN (p_source IN ('meta_ads','instagram')) THEN p_ad END,
    CASE WHEN NOT v_is_meta THEN v_campaign_id END,
    CASE WHEN NOT v_is_meta THEN v_adset_id END,
    CASE WHEN NOT v_is_meta THEN v_ad_id END,
    CASE WHEN v_is_meta THEN v_campaign_id END,
    CASE WHEN v_is_meta THEN v_adset_id END,
    CASE WHEN v_is_meta THEN v_ad_id END
  )
  RETURNING id INTO v_lead_id;

  IF v_lead_id IS NULL THEN
    IF NULLIF(trim(p_rast_id), '') IS NOT NULL THEN
      SELECT id INTO v_lead_id FROM public.leads
      WHERE clinic_id = p_clinic_id AND rast_id = trim(p_rast_id) LIMIT 1;
    END IF;
    IF v_lead_id IS NULL AND v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
      SELECT id INTO v_lead_id FROM public.leads
      WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
    END IF;
    v_created := false;
  ELSE
    v_created := true;
  END IF;

  UPDATE public.external_form_submissions SET lead_id = v_lead_id WHERE id = v_sub_id;

  RETURN jsonb_build_object('lead_id', v_lead_id, 'created', v_created, 'submission_id', v_sub_id);
END;
$function$;
