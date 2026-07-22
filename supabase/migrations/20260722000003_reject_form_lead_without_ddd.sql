-- Telefone sem DDD/DDI NÃO vira lead.
--
-- Causa do bug: o formulário aceitava "981214937" (9 dígitos, sem 55+DDD). normalize_br_phone
-- só completa o DDI quando há 10 ou 11 dígitos — com 9 ela devolve o número como veio. Como o
-- índice uq_leads_normalized_phone só cobre length >= 12, essas leads ficavam FORA da trava de
-- unicidade: quando a mesma pessoa mandava WhatsApp (552181214937), nada casava e nascia uma
-- SEGUNDA lead. 15 duplicatas confirmadas desde 13/04 (Vera Marsano, Wilson, Valdir, Kelly…).
--
-- Decisão do dono (22/07): lead sem DDD não entra no sistema.
-- A submissão continua gravada em external_form_submissions (auditoria, com lead_id NULL) e a
-- rejeição vai para a Central de Erros — perder em silêncio é o que não pode acontecer.
CREATE OR REPLACE FUNCTION public.ingest_external_form_lead(p_clinic_id uuid, p_name text, p_phone text, p_email text DEFAULT NULL::text, p_source text DEFAULT NULL::text, p_campaign text DEFAULT NULL::text, p_adset text DEFAULT NULL::text, p_ad text DEFAULT NULL::text, p_term text DEFAULT NULL::text, p_utm_source text DEFAULT NULL::text, p_ad_platform text DEFAULT NULL::text, p_raw jsonb DEFAULT NULL::jsonb, p_g_clid text DEFAULT NULL::text, p_fb_clid text DEFAULT NULL::text, p_rast_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- TRAVA: veio telefone, mas incompleto (sem DDD/DDI) → não cria lead.
  -- < 12 dígitos é exatamente a faixa que o índice de unicidade não cobre. Números
  -- estrangeiros legítimos (351…, 244…) têm 12+ e passam normalmente.
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
    fb_campaign_name, fb_adset_name, fb_ad_name
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
    CASE WHEN v_is_meta THEN p_ad END
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
