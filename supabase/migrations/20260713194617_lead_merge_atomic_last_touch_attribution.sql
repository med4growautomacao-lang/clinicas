-- 20260713194617_lead_merge_atomic_last_touch_attribution
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create or replace function public.fn_handle_lead_uniqueness()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
DECLARE
  v_existing_id uuid;
  v_nphone text;
  v_now timestamptz := now();
  v_has_attribution boolean;
BEGIN
  v_nphone := normalize_br_phone(NEW.phone);
  IF v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
    NEW.phone := v_nphone;
  END IF;

  IF NEW.rast_id IS NOT NULL AND NEW.rast_id <> '' THEN
    SELECT id INTO v_existing_id FROM public.leads WHERE clinic_id = NEW.clinic_id AND rast_id = NEW.rast_id LIMIT 1;
  END IF;

  IF v_existing_id IS NULL AND v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
    SELECT id INTO v_existing_id FROM public.leads WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    -- Este contato traz atribuição própria?
    v_has_attribution := (
      NULLIF(NEW.source, '')    IS NOT NULL OR
      NULLIF(NEW.g_clid, '')    IS NOT NULL OR
      NULLIF(NEW.fb_clid, '')   IS NOT NULL OR
      NULLIF(NEW.ctwa_clid, '') IS NOT NULL
    );

    UPDATE public.leads SET
      name  = COALESCE(NULLIF(NEW.name, ''), name),
      phone = COALESCE(normalize_br_phone(NULLIF(NEW.phone, '')), phone),
      email = COALESCE(NULLIF(NEW.email, ''), email),

      -- Identidade NUNCA é sobrescrita: quem já está na base manda.
      rast_id = COALESCE(NULLIF(rast_id, ''), NULLIF(NEW.rast_id, '')),
      capture_channel = COALESCE(NULLIF(NEW.capture_channel, ''), capture_channel),

      -- ATRIBUIÇÃO É UM BLOCO ATÔMICO (last-touch). Antes era campo a campo com
      -- COALESCE(NEW, atual), o que produzia leads Frankenstein: origem do 2º contato + campanha
      -- do Google do 1º + campanha do Meta do 2º, tudo misturado e sem data. Agora, se o contato
      -- traz atribuição, ela substitui a anterior INTEIRA (inclusive apagando o que não veio).
      -- O histórico completo não se perde: cada contato vira uma linha em lead_touchpoints.
      source           = CASE WHEN v_has_attribution THEN NEW.source           ELSE source           END,
      g_clid           = CASE WHEN v_has_attribution THEN NEW.g_clid           ELSE g_clid           END,
      g_campaign_name  = CASE WHEN v_has_attribution THEN NEW.g_campaign_name  ELSE g_campaign_name  END,
      g_adset_name     = CASE WHEN v_has_attribution THEN NEW.g_adset_name     ELSE g_adset_name     END,
      g_ad_name        = CASE WHEN v_has_attribution THEN NEW.g_ad_name        ELSE g_ad_name         END,
      g_term_name      = CASE WHEN v_has_attribution THEN NEW.g_term_name      ELSE g_term_name      END,
      g_source_name    = CASE WHEN v_has_attribution THEN NEW.g_source_name    ELSE g_source_name    END,
      fb_clid          = CASE WHEN v_has_attribution THEN NEW.fb_clid          ELSE fb_clid          END,
      fb_campaign_name = CASE WHEN v_has_attribution THEN NEW.fb_campaign_name ELSE fb_campaign_name END,
      fb_adset_name    = CASE WHEN v_has_attribution THEN NEW.fb_adset_name    ELSE fb_adset_name    END,
      fb_ad_name       = CASE WHEN v_has_attribution THEN NEW.fb_ad_name       ELSE fb_ad_name       END,
      ctwa_clid        = CASE WHEN v_has_attribution THEN NEW.ctwa_clid        ELSE ctwa_clid        END,

      updated_at = (now() AT TIME ZONE 'America/Sao_Paulo')
    WHERE id = v_existing_id;

    -- O contato aconteceu, mesmo que o lead tenha sido mesclado: vai para a jornada.
    IF coalesce(NEW.capture_channel, '') = 'forms' THEN
      INSERT INTO public.lead_touchpoints
        (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
      VALUES
        (NEW.clinic_id, v_existing_id, NULLIF(NEW.rast_id, ''), v_now, 'site_forms', NEW.source,
         COALESCE(NEW.g_campaign_name, NEW.fb_campaign_name),
         COALESCE(NEW.g_adset_name,   NEW.fb_adset_name),
         COALESCE(NEW.g_ad_name,      NEW.fb_ad_name),
         'Preencheu formulário novamente',
         'resubmit:' || v_existing_id::text || ':' || extract(epoch from v_now)::bigint::text)
      ON CONFLICT (channel, external_ref) DO NOTHING;
    END IF;

    RETURN NULL;
  END IF;

  IF NEW.rast_id IS NULL OR NEW.rast_id = '' THEN
    NEW.rast_id := gen_random_uuid()::text;
  END IF;

  RETURN NEW;
END; $function$;
