-- Ajuste da correção anterior, vindo da verificação adversarial de 27/07.
--
-- 1) REVERTE o gate de `app.crm_intake` em fn_reset_followup_on_new_ticket. Eu tinha suprimido o
--    reset achando que protegia o handoff, e a supressão criava um bug PIOR e silencioso:
--
--    O INSERT de ticket da RPC só acontece quando o lead NÃO tem ticket aberto, ou seja, quando o
--    ciclo anterior já foi FECHADO. Logo o `handoff_triggered_at` e o `followup_count` que estavam
--    lá pertencem ao ciclo MORTO. Suprimindo o reset, o card novo nascia herdando esse estado:
--    `fn_ai_loop_guard` e `fn_followup_candidates_reengagement` leem `handoff_triggered_at`, então o
--    lead ficava mudo para IA e follow-up no ciclo novo, para sempre, sem erro nenhum. Hoje 4.074
--    leads já carregam esse estado e virariam candidatos ao problema.
--
--    O risco que eu queria evitar (evento do CRM re-armar a régua para quem um humano assumiu) NÃO
--    é específico deste caminho: vale igual para Kanban, WhatsApp e todos os outros 4 caminhos de
--    criação de ticket. E foi medido: com o gate real sendo `leads.ai_enabled`, a simulação de pior
--    caso deu ZERO leads virando candidatos a reengajamento. Trocar comportamento uniforme por
--    exceção silenciosa é o pior dos dois lados. Fica como está no resto do sistema.
--
-- 2) fn_handle_lead_uniqueness era a QUARTA trigger que reage ao INSERT do lead do CRM e tinha
--    ficado de fora: no ramo de MESCLAGEM ela grava um toque dizendo "Preencheu formulário
--    novamente" para quem só teve um negócio criado no CRM. É a mesma mentira que já foi tirada do
--    fn_touchpoint_from_site_form, entrando pela outra porta. Só o TEXTO muda; nenhuma linha de
--    controle é tocada (o bloco atômico de atribuição fica intacto).

create or replace function public.fn_reset_followup_on_new_ticket()
returns trigger
language plpgsql
as $function$
BEGIN
  IF NEW.status = 'open' THEN
    -- Handoff: sempre limpo (ticket novo = atendimento novo). Não participa do loop.
    -- ⚠️ Vale TAMBÉM para o ticket aberto pelo webhook do CRM: ele só nasce quando o ciclo
    -- anterior já fechou, então o handoff que está aqui é do ciclo morto. Não limpar deixaria o
    -- card novo mudo para IA e follow-up, em silêncio.
    UPDATE public.leads
      SET handoff_triggered_at = NULL
      WHERE id = NEW.lead_id
        AND handoff_triggered_at IS NOT NULL;

    -- A régua só reinicia após a carência (3 dias). Sem isto, responder ao "vou encerrar" abre
    -- ticket novo, zera o contador e a perseguição recomeça do passo 1 (66 leads afetados; o
    -- "Cleberson" levou 7 mensagens em 3 ciclos).
    UPDATE public.leads
      SET followup_count   = 0,
          followup_sent_at = NULL
      WHERE id = NEW.lead_id
        AND (followup_count <> 0 OR followup_sent_at IS NOT NULL)
        AND (
          followup_sent_at IS NULL
          OR followup_sent_at < ((now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 days')
        );
  END IF;
  RETURN NEW;
END;
$function$;

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
      -- Os *_id entram AQUI junto dos nomes — nome e ID têm que descrever o MESMO toque.
      source           = CASE WHEN v_has_attribution THEN NEW.source           ELSE source           END,
      g_clid           = CASE WHEN v_has_attribution THEN NEW.g_clid           ELSE g_clid           END,
      g_campaign_name  = CASE WHEN v_has_attribution THEN NEW.g_campaign_name  ELSE g_campaign_name  END,
      g_adset_name     = CASE WHEN v_has_attribution THEN NEW.g_adset_name     ELSE g_adset_name     END,
      g_ad_name        = CASE WHEN v_has_attribution THEN NEW.g_ad_name        ELSE g_ad_name         END,
      g_term_name      = CASE WHEN v_has_attribution THEN NEW.g_term_name      ELSE g_term_name      END,
      g_source_name    = CASE WHEN v_has_attribution THEN NEW.g_source_name    ELSE g_source_name    END,
      g_campaign_id    = CASE WHEN v_has_attribution THEN NEW.g_campaign_id    ELSE g_campaign_id    END,
      g_adset_id       = CASE WHEN v_has_attribution THEN NEW.g_adset_id       ELSE g_adset_id       END,
      g_ad_id          = CASE WHEN v_has_attribution THEN NEW.g_ad_id          ELSE g_ad_id          END,
      fb_clid          = CASE WHEN v_has_attribution THEN NEW.fb_clid          ELSE fb_clid          END,
      fb_campaign_name = CASE WHEN v_has_attribution THEN NEW.fb_campaign_name ELSE fb_campaign_name END,
      fb_adset_name    = CASE WHEN v_has_attribution THEN NEW.fb_adset_name    ELSE fb_adset_name    END,
      fb_ad_name       = CASE WHEN v_has_attribution THEN NEW.fb_ad_name       ELSE fb_ad_name       END,
      fb_campaign_id   = CASE WHEN v_has_attribution THEN NEW.fb_campaign_id   ELSE fb_campaign_id   END,
      fb_adset_id      = CASE WHEN v_has_attribution THEN NEW.fb_adset_id      ELSE fb_adset_id      END,
      fb_ad_id         = CASE WHEN v_has_attribution THEN NEW.fb_ad_id         ELSE fb_ad_id         END,
      ctwa_clid        = CASE WHEN v_has_attribution THEN NEW.ctwa_clid        ELSE ctwa_clid        END,

      updated_at = (now() AT TIME ZONE 'America/Sao_Paulo')
    WHERE id = v_existing_id;

    -- O contato aconteceu, mesmo que o lead tenha sido mesclado: vai para a jornada.
    IF coalesce(NEW.capture_channel, '') = 'forms' THEN
      INSERT INTO public.lead_touchpoints
        (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad,
         campaign_id, adset_id, ad_id, detail, external_ref)
      VALUES
        (NEW.clinic_id, v_existing_id, NULLIF(NEW.rast_id, ''), v_now, 'site_forms', NEW.source,
         COALESCE(NEW.g_campaign_name, NEW.fb_campaign_name),
         COALESCE(NEW.g_adset_name,   NEW.fb_adset_name),
         COALESCE(NEW.g_ad_name,      NEW.fb_ad_name),
         COALESCE(NEW.g_campaign_id,  NEW.fb_campaign_id),
         COALESCE(NEW.g_adset_id,     NEW.fb_adset_id),
         COALESCE(NEW.g_ad_id,        NEW.fb_ad_id),
         -- Só o TEXTO muda: quem veio do webhook do CRM não preencheu formulário nenhum.
         CASE WHEN coalesce(current_setting('app.crm_intake', true), '') = '1'
              THEN 'Negócio criado no CRM externo'
              ELSE 'Preencheu formulário novamente' END,
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
