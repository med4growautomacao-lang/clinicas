-- 20260725022624_20260724232553_leads_ad_ids_and_ingest_capture
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Captura de IDs de campanha/conjunto/anúncio no lead (Meta e Google), vindos do formulário via
-- o script global (params campaign_id/adset_id/ad_id na URL → campos ocultos → external-forms-ingest).
-- Segue o mesmo roteamento g_*/fb_* por origem que os NOMES já usam. Chave estável p/ o join do
-- Marketing (ID não corrompe/trunca como o nome). Colunas nullable e aditivas.
alter table public.leads
  add column if not exists g_campaign_id  text,
  add column if not exists g_adset_id     text,
  add column if not exists g_ad_id        text,
  add column if not exists fb_campaign_id text,
  add column if not exists fb_adset_id    text,
  add column if not exists fb_ad_id       text;

-- Recria a RPC de ingestão com os 3 params de ID (drop necessário: assinatura muda de aridade).
drop function if exists public.ingest_external_form_lead(uuid, text, text, text, text, text, text, text, text, text, text, jsonb, text, text, text);

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
    CASE WHEN NOT v_is_meta THEN p_campaign END,
    CASE WHEN NOT v_is_meta THEN p_adset END,
    CASE WHEN NOT v_is_meta THEN p_ad END,
    CASE WHEN NOT v_is_meta THEN p_term END,
    NULLIF(trim(p_utm_source), ''),
    CASE WHEN v_is_meta THEN p_campaign END,
    CASE WHEN v_is_meta THEN p_adset END,
    CASE WHEN v_is_meta THEN p_ad END,
    CASE WHEN NOT v_is_meta THEN NULLIF(trim(p_campaign_id), '') END,
    CASE WHEN NOT v_is_meta THEN NULLIF(trim(p_adset_id), '') END,
    CASE WHEN NOT v_is_meta THEN NULLIF(trim(p_ad_id), '') END,
    CASE WHEN v_is_meta THEN NULLIF(trim(p_campaign_id), '') END,
    CASE WHEN v_is_meta THEN NULLIF(trim(p_adset_id), '') END,
    CASE WHEN v_is_meta THEN NULLIF(trim(p_ad_id), '') END
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
