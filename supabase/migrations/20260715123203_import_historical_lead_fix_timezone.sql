-- 20260715123203_import_historical_lead_fix_timezone
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Fix: p_outcome_at e touches[].occurred_at agora são NAIVE (SP wall-clock), convertidos
-- via AT TIME ZONE 'America/Sao_Paulo' dentro da função — mesmo padrão do created_at e do
-- resto do sistema. Antes: p_outcome_at era timestamptz e o touch usava ::timestamptz direto,
-- o que exigia o CHAMADOR acertar o offset manualmente -> risco real de deslocar 3h (já
-- provado no teste manual: touches com "+00" != created_at convertido de SP).
CREATE OR REPLACE FUNCTION public.import_historical_lead(
  p_clinic_id   uuid,
  p_phone       text,
  p_name        text,
  p_email       text,
  p_source      text,
  p_campaign    text,
  p_adset       text,
  p_ad          text,
  p_ad_platform text,
  p_raw_platform text,
  p_created_at  timestamp,     -- SP naive (primeira data de contato)
  p_outcome     text,          -- 'ganho' | 'perdido' | NULL
  p_outcome_at  timestamp,     -- SP naive (data real do desfecho) ou NULL
  p_loss_reason text,
  p_touches     jsonb          -- [{occurred_at: 'YYYY-MM-DD HH:MI:SS' SP naive, qualificacao, row_number}]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_nphone   text;
  v_existing record;
  v_lead_id  uuid;
  v_ticket_id uuid;
  v_stage_id uuid;
  v_touch    jsonb;
  v_touch_count integer := 0;
  v_outcome_at_tz timestamptz;
  v_is_google boolean := (p_source = 'google_ads');
  v_is_meta   boolean := (p_source IN ('meta_ads','instagram'));
BEGIN
  v_nphone := normalize_br_phone(p_phone);

  IF v_nphone IS NULL OR length(v_nphone) < 12 THEN
    INSERT INTO public.historical_leads_import_log (clinic_id, phone_norm, skipped_reason)
    VALUES (p_clinic_id, COALESCE(v_nphone, p_phone, 'sem_telefone'), 'telefone_invalido')
    ON CONFLICT (clinic_id, phone_norm) DO NOTHING;
    RETURN jsonb_build_object('skipped', true, 'reason', 'telefone_invalido');
  END IF;

  SELECT * INTO v_existing FROM public.historical_leads_import_log
   WHERE clinic_id = p_clinic_id AND phone_norm = v_nphone;
  IF FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'ja_importado', 'lead_id', v_existing.lead_id);
  END IF;

  v_outcome_at_tz := (p_outcome_at AT TIME ZONE 'America/Sao_Paulo');

  SELECT id INTO v_lead_id FROM public.leads
   WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (
      clinic_id, name, phone, email, source, capture_channel, ad_platform,
      g_campaign_name, g_adset_name, g_ad_name,
      fb_campaign_name, fb_adset_name, fb_ad_name,
      created_at, updated_at
    ) VALUES (
      p_clinic_id, COALESCE(NULLIF(trim(p_name),''),'Lead'), v_nphone, NULLIF(trim(p_email),''),
      p_source, 'forms', p_ad_platform,
      CASE WHEN v_is_google THEN p_campaign END, CASE WHEN v_is_google THEN p_adset END, CASE WHEN v_is_google THEN p_ad END,
      CASE WHEN v_is_meta   THEN p_campaign END, CASE WHEN v_is_meta   THEN p_adset END, CASE WHEN v_is_meta   THEN p_ad END,
      p_created_at, p_created_at
    )
    RETURNING id INTO v_lead_id;
  END IF;

  IF v_lead_id IS NULL THEN
    SELECT id INTO v_lead_id FROM public.leads
     WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
  END IF;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.historical_leads_import_log (clinic_id, phone_norm, skipped_reason)
    VALUES (p_clinic_id, v_nphone, 'lead_indisponivel');
    RETURN jsonb_build_object('skipped', true, 'reason', 'lead_indisponivel');
  END IF;

  SELECT id INTO v_ticket_id FROM public.tickets
   WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_ticket_id IS NULL THEN
    SELECT id INTO v_ticket_id FROM public.tickets
     WHERE lead_id = v_lead_id ORDER BY opened_at DESC LIMIT 1;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    IF p_outcome IN ('ganho','perdido') THEN
      SELECT id INTO v_stage_id FROM public.funnel_stages
       WHERE clinic_id = p_clinic_id AND slug = p_outcome LIMIT 1;
      UPDATE public.tickets SET
        status      = 'closed',
        closed_at   = COALESCE(closed_at, v_outcome_at_tz, (p_created_at AT TIME ZONE 'America/Sao_Paulo')),
        outcome     = p_outcome,
        outcome_at  = COALESCE(v_outcome_at_tz, (p_created_at AT TIME ZONE 'America/Sao_Paulo')),
        loss_reason = CASE WHEN p_outcome = 'perdido' THEN p_loss_reason ELSE loss_reason END,
        stage_id    = COALESCE(v_stage_id, stage_id),
        notes       = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END
                        || 'Importado do histórico (planilha Clint).'
      WHERE id = v_ticket_id;
    ELSIF (SELECT status FROM public.tickets WHERE id = v_ticket_id) = 'open' THEN
      UPDATE public.tickets SET
        status = 'closed',
        closed_at = (p_created_at AT TIME ZONE 'America/Sao_Paulo'),
        notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END
                  || 'Importado do histórico (planilha Clint) — sem desfecho registrado.'
      WHERE id = v_ticket_id;
    END IF;
  END IF;

  IF p_touches IS NOT NULL THEN
    FOR v_touch IN SELECT * FROM jsonb_array_elements(p_touches) LOOP
      INSERT INTO public.lead_touchpoints
        (clinic_id, lead_id, occurred_at, channel, source, campaign, adset, ad, ad_platform, detail, external_ref, metadata)
      VALUES (
        p_clinic_id, v_lead_id,
        ((v_touch->>'occurred_at')::timestamp AT TIME ZONE 'America/Sao_Paulo'),
        'site_forms', p_source, p_campaign, p_adset, p_ad, p_ad_platform,
        'Histórico importado: ' || COALESCE(v_touch->>'qualificacao', 'Lead'),
        'historical:' || p_clinic_id::text || ':' || v_nphone || ':' || COALESCE(v_touch->>'row_number','0'),
        jsonb_build_object('plataforma_raw', p_raw_platform)
      )
      ON CONFLICT (channel, external_ref) DO NOTHING;
      v_touch_count := v_touch_count + 1;
    END LOOP;
  END IF;

  INSERT INTO public.historical_leads_import_log
    (clinic_id, phone_norm, lead_id, ticket_id, outcome_applied, touches_count)
  VALUES (p_clinic_id, v_nphone, v_lead_id, v_ticket_id, p_outcome, v_touch_count);

  RETURN jsonb_build_object('ok', true, 'lead_id', v_lead_id, 'ticket_id', v_ticket_id, 'outcome', p_outcome, 'touches', v_touch_count);
END;
$function$;
