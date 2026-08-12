-- 20260715031842_external_crm_outcome_rpc
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Ledger de eventos de Ganho/Perdido recebidos do CRM do cliente (append-only, auditoria).
CREATE TABLE IF NOT EXISTS public.external_crm_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id      uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ticket_id    uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  outcome      text,
  name         text,
  phone        text,
  email        text,
  loss_reason  text,
  raw          jsonb,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ece_clinic_received ON public.external_crm_events (clinic_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ece_lead ON public.external_crm_events (lead_id);

ALTER TABLE public.external_crm_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ece_select ON public.external_crm_events
  FOR SELECT USING (
    clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid())
    OR public.is_clinic_admin(clinic_id)
  );

-- Aplica Ganho/Perdido vindo do CRM do cliente (ENTRADA). Match telefone->email; se não achar o
-- lead, cria (upsert, como o appendOrUpdate da planilha); depois finaliza o ticket via finalize_ticket
-- (única porta p/ outcome — respeita a invariante stage<->outcome). Idempotente p/ ticket já no mesmo
-- outcome. NUNCA insere em tickets/outcome direto.
CREATE OR REPLACE FUNCTION public.apply_external_crm_outcome(
  p_clinic_id   uuid,
  p_outcome     text,                 -- 'ganho' | 'perdido'
  p_phone       text,
  p_email       text DEFAULT NULL,
  p_name        text DEFAULT NULL,
  p_loss_reason text DEFAULT NULL,
  p_source      text DEFAULT NULL,     -- usados só na CRIAÇÃO do lead (upsert)
  p_campaign    text DEFAULT NULL,
  p_adset       text DEFAULT NULL,
  p_ad          text DEFAULT NULL,
  p_ad_platform text DEFAULT NULL,
  p_raw         jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id  uuid;
  v_lead_id   uuid;
  v_ticket_id uuid;
  v_nphone    text;
  v_created   boolean := false;
  v_is_google boolean := (p_source = 'google_ads');
  v_is_meta   boolean := (p_source IN ('meta_ads','instagram'));
  v_cur_out   text;
  v_fin       jsonb;
BEGIN
  IF p_outcome NOT IN ('ganho','perdido') THEN
    RETURN jsonb_build_object('error','invalid_outcome');
  END IF;

  INSERT INTO public.external_crm_events (clinic_id, outcome, name, phone, email, loss_reason, raw)
  VALUES (p_clinic_id, p_outcome, p_name, p_phone, p_email, p_loss_reason, p_raw)
  RETURNING id INTO v_event_id;

  v_nphone := normalize_br_phone(p_phone);

  -- Match: telefone normalizado primeiro, e-mail como fallback
  IF v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
    SELECT id INTO v_lead_id FROM public.leads
     WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
  END IF;
  IF v_lead_id IS NULL AND NULLIF(trim(p_email),'') IS NOT NULL THEN
    SELECT id INTO v_lead_id FROM public.leads
     WHERE clinic_id = p_clinic_id AND lower(email) = lower(trim(p_email)) LIMIT 1;
  END IF;

  -- Upsert: sem lead, cria (capture_channel='forms' -> auto-abre ticket via trigger)
  IF v_lead_id IS NULL THEN
    IF COALESCE(NULLIF(trim(p_phone),''), NULLIF(trim(p_email),'')) IS NULL THEN
      RETURN jsonb_build_object('error','sem_identidade','event_id',v_event_id);
    END IF;
    INSERT INTO public.leads (
      clinic_id, name, phone, email, source, capture_channel, ad_platform,
      g_campaign_name, g_adset_name, g_ad_name, fb_campaign_name, fb_adset_name, fb_ad_name
    ) VALUES (
      p_clinic_id, COALESCE(NULLIF(trim(p_name),''),'Lead'),
      COALESCE(v_nphone, NULLIF(trim(p_phone),'')), NULLIF(trim(p_email),''),
      p_source, 'forms', NULLIF(trim(p_ad_platform),''),
      CASE WHEN v_is_google THEN p_campaign END, CASE WHEN v_is_google THEN p_adset END, CASE WHEN v_is_google THEN p_ad END,
      CASE WHEN v_is_meta   THEN p_campaign END, CASE WHEN v_is_meta   THEN p_adset END, CASE WHEN v_is_meta   THEN p_ad END
    )
    RETURNING id INTO v_lead_id;
    IF v_lead_id IS NULL AND v_nphone IS NOT NULL THEN
      SELECT id INTO v_lead_id FROM public.leads
       WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
    ELSE
      v_created := true;
    END IF;
  END IF;

  IF v_lead_id IS NULL THEN
    RETURN jsonb_build_object('error','lead_indisponivel','event_id',v_event_id);
  END IF;

  -- Ticket alvo: aberto primeiro; senão o mais recente (finalize_ticket sobrescreve fechado)
  SELECT id, outcome INTO v_ticket_id, v_cur_out FROM public.tickets
   WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
  IF v_ticket_id IS NULL THEN
    SELECT id, outcome INTO v_ticket_id, v_cur_out FROM public.tickets
     WHERE lead_id = v_lead_id ORDER BY opened_at DESC LIMIT 1;
  END IF;

  IF v_ticket_id IS NULL THEN
    UPDATE public.external_crm_events SET lead_id = v_lead_id WHERE id = v_event_id;
    RETURN jsonb_build_object('error','sem_ticket','lead_id',v_lead_id,'event_id',v_event_id);
  END IF;

  -- Idempotência: ticket já está nesse outcome -> não re-finaliza
  IF v_cur_out IS NOT NULL AND v_cur_out = p_outcome THEN
    UPDATE public.external_crm_events SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;
    RETURN jsonb_build_object('ok',true,'skipped',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome',p_outcome,'created_lead',v_created);
  END IF;

  v_fin := public.finalize_ticket(v_ticket_id, p_outcome, p_loss_reason, NULL, true);

  UPDATE public.external_crm_events SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;

  RETURN jsonb_build_object('ok',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome',p_outcome,'created_lead',v_created,'finalize',v_fin);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_external_crm_outcome(uuid,text,text,text,text,text,text,text,text,text,text,jsonb) FROM anon;
