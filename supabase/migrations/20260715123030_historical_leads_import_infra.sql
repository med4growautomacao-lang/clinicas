-- 20260715123030_historical_leads_import_infra
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Backfill histórico da planilha "Intubação | Rastreio UTMs" (Clint) para o banco.
-- Ledger idempotente: 1 linha por (clinic_id, telefone normalizado). Reexecutar não duplica.
CREATE TABLE IF NOT EXISTS public.historical_leads_import_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  phone_norm     text NOT NULL,
  lead_id        uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ticket_id      uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  outcome_applied text,
  touches_count  integer NOT NULL DEFAULT 0,
  skipped_reason text,
  imported_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, phone_norm)
);

ALTER TABLE public.historical_leads_import_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY hlil_select ON public.historical_leads_import_log
  FOR SELECT USING (public.is_clinic_admin(clinic_id) OR public.is_super_admin());

-- Importa 1 lead histórico agregado (já deduplicado por telefone na aplicação chamadora).
-- Idempotente: se o telefone já foi importado para essa clínica, retorna o resultado anterior
-- sem reprocessar. created_at/outcome_at são EXPLÍCITOS (histórico real, nunca now()).
-- touches[] = array de {occurred_at, detail} para popular a jornada (lead_touchpoints) completa.
CREATE OR REPLACE FUNCTION public.import_historical_lead(
  p_clinic_id   uuid,
  p_phone       text,
  p_name        text,
  p_email       text,
  p_source      text,          -- já mapeado (meta_ads/google_ads/instagram) ou NULL
  p_campaign    text,
  p_adset       text,
  p_ad          text,
  p_ad_platform text,          -- já derivado (facebook/instagram) ou NULL
  p_raw_platform text,         -- valor cru da coluna Plataforma (auditoria, ex.: tiktok)
  p_created_at  timestamp,     -- SP naive (primeira data de contato)
  p_outcome     text,          -- 'ganho' | 'perdido' | NULL
  p_outcome_at  timestamptz,   -- data real do desfecho (ou NULL)
  p_loss_reason text,
  p_touches     jsonb          -- [{occurred_at: 'YYYY-MM-DD HH:MI:SS', qualificacao: '...'}]
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
  v_is_google boolean := (p_source = 'google_ads');
  v_is_meta   boolean := (p_source IN ('meta_ads','instagram'));
BEGIN
  v_nphone := normalize_br_phone(p_phone);

  -- Telefone inválido/curto demais: não dá pra normalizar como BR -> pula (decisão do usuário).
  IF v_nphone IS NULL OR length(v_nphone) < 12 THEN
    INSERT INTO public.historical_leads_import_log (clinic_id, phone_norm, skipped_reason)
    VALUES (p_clinic_id, COALESCE(v_nphone, p_phone, 'sem_telefone'), 'telefone_invalido')
    ON CONFLICT (clinic_id, phone_norm) DO NOTHING;
    RETURN jsonb_build_object('skipped', true, 'reason', 'telefone_invalido');
  END IF;

  -- Idempotência: já importado?
  SELECT * INTO v_existing FROM public.historical_leads_import_log
   WHERE clinic_id = p_clinic_id AND phone_norm = v_nphone;
  IF FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'ja_importado', 'lead_id', v_existing.lead_id);
  END IF;

  -- Lead já existe (de captação viva, ou já mesclado por rast_id/telefone)? Reaproveita.
  SELECT id INTO v_lead_id FROM public.leads
   WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;

  IF v_lead_id IS NULL THEN
    -- Novo lead histórico: created_at EXPLÍCITO (não now()). Triggers cuidam de
    -- dedup/ticket/1º touchpoint automaticamente (fn_auto_open_ticket_forms etc.).
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
    -- Corrida rara (merge concorrente): busca de novo.
    SELECT id INTO v_lead_id FROM public.leads
     WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
  END IF;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.historical_leads_import_log (clinic_id, phone_norm, skipped_reason)
    VALUES (p_clinic_id, v_nphone, 'lead_indisponivel');
    RETURN jsonb_build_object('skipped', true, 'reason', 'lead_indisponivel');
  END IF;

  -- Ticket alvo: aberto primeiro; senão o mais recente.
  SELECT id INTO v_ticket_id FROM public.tickets
   WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_ticket_id IS NULL THEN
    SELECT id INTO v_ticket_id FROM public.tickets
     WHERE lead_id = v_lead_id ORDER BY opened_at DESC LIMIT 1;
  END IF;

  IF v_ticket_id IS NOT NULL THEN
    IF p_outcome IN ('ganho','perdido') THEN
      -- Aplica o desfecho com DATA HISTÓRICA explícita (finalize_ticket usa now(); aqui não pode).
      SELECT id INTO v_stage_id FROM public.funnel_stages
       WHERE clinic_id = p_clinic_id AND slug = p_outcome LIMIT 1;
      UPDATE public.tickets SET
        status      = 'closed',
        closed_at   = COALESCE(closed_at, p_outcome_at, p_created_at::timestamptz),
        outcome     = p_outcome,
        outcome_at  = COALESCE(p_outcome_at, p_created_at::timestamptz),
        loss_reason = CASE WHEN p_outcome = 'perdido' THEN p_loss_reason ELSE loss_reason END,
        stage_id    = COALESCE(v_stage_id, stage_id),
        notes       = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END
                        || 'Importado do histórico (planilha Clint).'
      WHERE id = v_ticket_id;
    ELSIF (SELECT status FROM public.tickets WHERE id = v_ticket_id) = 'open' THEN
      -- Sem desfecho (\"Lead\" puro): fecha sem outcome, pra NÃO poluir o Kanban ativo.
      UPDATE public.tickets SET
        status = 'closed',
        closed_at = p_created_at::timestamptz,
        notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\n' END
                  || 'Importado do histórico (planilha Clint) — sem desfecho registrado.'
      WHERE id = v_ticket_id;
    END IF;
  END IF;

  -- Jornada completa: 1 touchpoint por toque original (datas históricas reais).
  IF p_touches IS NOT NULL THEN
    FOR v_touch IN SELECT * FROM jsonb_array_elements(p_touches) LOOP
      INSERT INTO public.lead_touchpoints
        (clinic_id, lead_id, occurred_at, channel, source, campaign, adset, ad, ad_platform, detail, external_ref, metadata)
      VALUES (
        p_clinic_id, v_lead_id, (v_touch->>'occurred_at')::timestamptz, 'site_forms', p_source,
        p_campaign, p_adset, p_ad, p_ad_platform,
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

REVOKE ALL ON FUNCTION public.import_historical_lead(uuid,text,text,text,text,text,text,text,text,text,timestamp,text,timestamptz,text,jsonb) FROM anon;
