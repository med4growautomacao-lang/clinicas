-- Integração Externa: TERCEIRA entrada do CRM do cliente — LEAD NOVO.
--
-- Até aqui o webhook do CRM (external-crm-status) só sabia refletir DESFECHO: ganho e perdido.
-- Quem usa Clint (e afins) também cria o negócio lá antes de qualquer desfecho, e esse lead não
-- tinha por onde entrar — só via external-forms-ingest, que fala o dialeto de FORMULÁRIO, não o
-- dialeto contact_*/deal_* do CRM. Resultado: o lead só aparecia aqui quando já estava ganho/perdido,
-- e o funil nascia sem a etapa de entrada.
--
-- Decisões:
--  • Mesma máquina, mesmo token (crm_token), só muda ?tipo=lead — a clínica não gerencia 3 segredos.
--  • 'lead' NUNCA chama finalize_ticket. Ele garante lead + ticket ABERTO e para por aí.
--  • Se o lead já existe mas está sem ticket aberto, abre um NOVO ciclo (negócio novo no CRM = nova
--    negociação), com a MESMA régua de etapa do fn_auto_open_ticket_forms (forms -> whatsapp -> 1ª).
--  • Nasce DESLIGADO (lead_enabled default false), como won/lost.

alter table public.clinic_external_integrations
  add column if not exists lead_enabled boolean not null default false;

comment on column public.clinic_external_integrations.lead_enabled is
  'Liga a entrada de LEAD NOVO vinda do CRM do cliente (external-crm-status?tipo=lead). Nasce desligada.';

create or replace function public.apply_external_crm_outcome(
  p_clinic_id uuid,
  p_outcome text,
  p_phone text,
  p_email text default null,
  p_name text default null,
  p_loss_reason text default null,
  p_source text default null,
  p_campaign text default null,
  p_adset text default null,
  p_ad text default null,
  p_ad_platform text default null,
  p_raw jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_event_id  uuid;
  v_lead_id   uuid;
  v_ticket_id uuid;
  v_stage_id  uuid;
  v_nphone    text;
  v_created   boolean := false;
  v_new_tkt   boolean := false;
  v_is_google boolean := (p_source = 'google_ads');
  v_is_meta   boolean := (p_source IN ('meta_ads','instagram'));
  v_cur_out   text;
  v_fin       jsonb;
BEGIN
  IF p_outcome NOT IN ('ganho','perdido','lead') THEN
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

    IF v_lead_id IS NOT NULL THEN
      v_created := true;
    ELSE
      -- fn_handle_lead_uniqueness devolveu NULL: o contato foi mesclado num lead que já existia.
      -- Reencontra por telefone E por e-mail — só por telefone, um evento que veio só com e-mail
      -- caía em 'lead_indisponivel' mesmo com o lead vivo na base.
      IF v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
        SELECT id INTO v_lead_id FROM public.leads
         WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
      END IF;
      IF v_lead_id IS NULL AND NULLIF(trim(p_email),'') IS NOT NULL THEN
        SELECT id INTO v_lead_id FROM public.leads
         WHERE clinic_id = p_clinic_id AND lower(email) = lower(trim(p_email)) LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_lead_id IS NULL THEN
    RETURN jsonb_build_object('error','lead_indisponivel','event_id',v_event_id);
  END IF;

  -- ── LEAD NOVO: garante ticket ABERTO e para. Sem desfecho, sem finalize_ticket. ──────────────
  IF p_outcome = 'lead' THEN
    SELECT id INTO v_ticket_id FROM public.tickets
     WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;

    IF v_ticket_id IS NULL THEN
      -- Mesma régua de etapa do fn_auto_open_ticket_forms.
      SELECT id INTO v_stage_id FROM public.funnel_stages
       WHERE clinic_id = p_clinic_id AND slug = 'forms' ORDER BY position LIMIT 1;
      IF v_stage_id IS NULL THEN
        SELECT id INTO v_stage_id FROM public.funnel_stages
         WHERE clinic_id = p_clinic_id AND slug = 'whatsapp' ORDER BY position LIMIT 1;
      END IF;
      IF v_stage_id IS NULL THEN
        SELECT id INTO v_stage_id FROM public.funnel_stages
         WHERE clinic_id = p_clinic_id ORDER BY position LIMIT 1;
      END IF;

      IF v_stage_id IS NULL THEN
        UPDATE public.external_crm_events SET lead_id = v_lead_id WHERE id = v_event_id;
        RETURN jsonb_build_object('error','sem_etapa_no_funil','lead_id',v_lead_id,'event_id',v_event_id);
      END IF;

      BEGIN
        INSERT INTO public.tickets (clinic_id, lead_id, stage_id, status, opened_at)
        VALUES (p_clinic_id, v_lead_id, v_stage_id, 'open', now())
        RETURNING id INTO v_ticket_id;
        v_new_tkt := true;
      EXCEPTION WHEN unique_violation THEN
        -- uq_tickets_one_open_per_lead: outra rota abriu o ticket no meio do caminho. Usa o dela.
        SELECT id INTO v_ticket_id FROM public.tickets
         WHERE lead_id = v_lead_id AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
      END;
    END IF;

    UPDATE public.external_crm_events SET lead_id = v_lead_id, ticket_id = v_ticket_id WHERE id = v_event_id;

    RETURN jsonb_build_object('ok',true,'lead_id',v_lead_id,'ticket_id',v_ticket_id,'outcome','lead',
                              'created_lead',v_created,'created_ticket',v_new_tkt);
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
