-- 20260725032102_20260725002024_touchpoint_ad_ids_and_atomic_attribution
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1) A JORNADA passa a carregar o ID do anúncio, não só o nome. Cada toque guarda a campanha/
--    conjunto/anúncio em ID (chave estável) além do texto, que trunca/corrompe (emoji, espaço).
alter table public.lead_touchpoints
  add column if not exists campaign_id text,
  add column if not exists adset_id    text,
  add column if not exists ad_id       text;

-- 2) fn_handle_lead_uniqueness: o bloco de atribuição LAST-TOUCH voltou a ser ATÔMICO.
--    As colunas *_id de anúncio foram criadas hoje (migr 20260724232553) e ficaram DE FORA deste
--    UPDATE — o lead reatribuído passava a ter o NOME da campanha do toque novo e o ID do toque
--    antigo (ou null): exatamente o "lead Frankenstein" que este bloco existe para evitar.
--    Agora os 6 IDs entram no mesmo CASE do resto da atribuição. O toque também grava os IDs.
CREATE OR REPLACE FUNCTION public.fn_handle_lead_uniqueness()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

-- 3) Toque do PRIMEIRO formulário (lead novo) também grava os IDs.
CREATE OR REPLACE FUNCTION public.fn_touchpoint_from_site_form()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(new.capture_channel, '') <> 'forms' then
    return null;
  end if;

  if exists (
    select 1 from public.meta_form_submissions lt
    where lt.clinic_id = new.clinic_id
      and lt.channel = 'meta_forms'
      and (
        (nullif(new.rast_id, '') is not null and lt.rast_id = new.rast_id)
        or (lt.phone_norm is not null and lt.phone_norm = normalize_br_phone(new.phone))
      )
  ) then
    return null;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad,
     campaign_id, adset_id, ad_id, ad_platform, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',
     'site_forms', new.source,
     coalesce(new.g_campaign_name, new.fb_campaign_name),
     coalesce(new.g_adset_name,   new.fb_adset_name),
     coalesce(new.g_ad_name,      new.fb_ad_name),
     coalesce(new.g_campaign_id,  new.fb_campaign_id),
     coalesce(new.g_adset_id,     new.fb_adset_id),
     coalesce(new.g_ad_id,        new.fb_ad_id),
     new.ad_platform,
     'Preencheu formulário', new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$function$;
