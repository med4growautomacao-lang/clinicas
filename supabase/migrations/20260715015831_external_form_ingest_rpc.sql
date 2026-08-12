-- 20260715015831_external_form_ingest_rpc
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Ledger de TODA submissão recebida no webhook externo (append-only): serve de auditoria e de
-- "form disparou mas não virou lead?". Espelha o papel do meta_form_submissions, sem exigir
-- external_id estável (o dedup de lead por telefone já evita duplicata na tabela leads).
CREATE TABLE IF NOT EXISTS public.external_form_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id      uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  name         text,
  phone        text,
  email        text,
  source       text,
  campaign     text,
  adset        text,
  ad           text,
  term         text,
  utm_source   text,
  raw          jsonb,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_efs_clinic_received ON public.external_form_submissions (clinic_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_efs_lead ON public.external_form_submissions (lead_id);

ALTER TABLE public.external_form_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY efs_select ON public.external_form_submissions
  FOR SELECT USING (public.is_clinic_admin(clinic_id) OR public.is_super_admin());

-- Ingestão de lead de formulário EXTERNO (site do cliente que dispara por webhook).
-- Fina de propósito: um INSERT em leads com capture_channel='forms' já aciona no banco:
--   • fn_handle_lead_uniqueness  → normaliza telefone + dedup/merge (retorna NULL no merge)
--   • fn_auto_open_ticket_forms  → abre o ticket na etapa de entrada
--   • fn_touchpoint_from_site_form → grava o touchpoint 'site_forms'
--   • fn_lead_pull_tracking      → puxa atribuição do attribution_inbox (clique anterior)
-- Aqui só mapeamos UTM→origem e roteamos campanha p/ os campos g_*/fb_* certos.
CREATE OR REPLACE FUNCTION public.ingest_external_form_lead(
  p_clinic_id  uuid,
  p_name       text,
  p_phone      text,
  p_email      text DEFAULT NULL,
  p_source     text DEFAULT NULL,   -- já mapeado (google_ads/meta_ads/instagram) ou NULL = orgânico
  p_campaign   text DEFAULT NULL,
  p_adset      text DEFAULT NULL,
  p_ad         text DEFAULT NULL,
  p_term       text DEFAULT NULL,
  p_utm_source text DEFAULT NULL,   -- guardado cru no ledger p/ auditoria
  p_raw        jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_id   uuid;
  v_lead_id  uuid;
  v_nphone   text;
  v_created  boolean := false;
  v_is_google boolean := (p_source = 'google_ads');
  v_is_meta   boolean := (p_source IN ('meta_ads','instagram'));
BEGIN
  -- 1) Log SEMPRE (mesmo submissão inválida vira registro auditável)
  INSERT INTO public.external_form_submissions
    (clinic_id, name, phone, email, source, campaign, adset, ad, term, utm_source, raw)
  VALUES
    (p_clinic_id, p_name, p_phone, p_email, p_source, p_campaign, p_adset, p_ad, p_term, p_utm_source, p_raw)
  RETURNING id INTO v_sub_id;

  -- 2) Identidade mínima: sem telefone E sem e-mail não há como criar/casar lead
  IF COALESCE(NULLIF(trim(p_phone), ''), NULLIF(trim(p_email), '')) IS NULL THEN
    RETURN jsonb_build_object('error', 'sem_identidade', 'submission_id', v_sub_id);
  END IF;

  v_nphone := normalize_br_phone(p_phone);

  -- 3) Insere o lead; os triggers cuidam de dedup/ticket/touchpoint.
  --    (fn_handle_lead_uniqueness retorna NULL quando faz merge → RETURNING vem NULL.)
  INSERT INTO public.leads (
    clinic_id, name, phone, email, source, capture_channel,
    g_campaign_name, g_adset_name, g_ad_name, g_term_name,
    fb_campaign_name, fb_adset_name, fb_ad_name
  ) VALUES (
    p_clinic_id,
    COALESCE(NULLIF(trim(p_name), ''), 'Lead'),
    COALESCE(v_nphone, NULLIF(trim(p_phone), '')),
    NULLIF(trim(p_email), ''),
    p_source,
    'forms',
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
    -- Merge: o lead já existia (mesmo telefone). Recupera o id do existente.
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

REVOKE ALL ON FUNCTION public.ingest_external_form_lead(uuid,text,text,text,text,text,text,text,text,text,jsonb) FROM anon;
