-- Paridade do caminho nativo de formulário + roteamento fb_* no clique do site.
--
-- Contexto (auditoria de 15/07, comparando external-forms-ingest × n8n forms_tracking):
--
-- 1. `ingest_external_form_lead` CALCULAVA a origem a partir dos click-ids mas NÃO OS GRAVAVA —
--    o RPC nem tinha parâmetro. O lead saía `source='google_ads'` sem `g_clid` na coluna. O gclid
--    é o que permite importar conversão offline no Google Ads; ficar só no `raw` é ficar no lixo.
--    O fluxo n8n gravava. Regressão de paridade → corrigida com p_g_clid / p_fb_clid.
--
-- 2. Também não recebia `rast_id` — o lead de formulário nascia SEM a identidade do visitante
--    (cookie de 2 anos), quebrando a jornada multi-toque do lado dos forms. O n8n gravava.
--    → p_rast_id. A segurança vem de graça: o INSERT passa pela fn_handle_lead_uniqueness, que
--    casa por rast_id ANTES de telefone (dedup) e nunca sobrescreve identidade existente.
--
-- 3. `site_ingest_click` gravava campanha de anúncio META em colunas g_* (do Google). O RPC irmão
--    já roteava por origem; este passa a rotear igual: meta/instagram → fb_*, resto → g_*.
--    `fn_apply_inbox_to_lead` já aplica os dois lados — nada a mudar lá.
--
-- Junto com isto, as DUAS edges passam a usar o mapeador único `_shared/attribution.ts`
-- (convenção UTM canônica, source-aware). O histórico não é reescrito.
--
-- ⚠️ DROP + CREATE (não CREATE OR REPLACE): adicionar parâmetro com DEFAULT criaria um OVERLOAD
--    e o PostgREST passaria a ver duas funções com o mesmo nome → ambiguidade na chamada RPC.
--    Dentro da transação não há janela. A edge v3 (deployada) chama com os parâmetros antigos e
--    continua funcionando — os novos têm DEFAULT NULL.

begin;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1+2) ingest_external_form_lead ganha clids + rast_id
-- ═════════════════════════════════════════════════════════════════════════════
drop function if exists public.ingest_external_form_lead(uuid, text, text, text, text, text, text, text, text, text, text, jsonb);

create function public.ingest_external_form_lead(
  p_clinic_id   uuid,
  p_name        text,
  p_phone       text,
  p_email       text default null,
  p_source      text default null,
  p_campaign    text default null,
  p_adset       text default null,
  p_ad          text default null,
  p_term        text default null,
  p_utm_source  text default null,
  p_ad_platform text default null,
  p_raw         jsonb default null,
  p_g_clid      text default null,
  p_fb_clid     text default null,
  p_rast_id     text default null
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
  -- Ledger: TODA submissão fica registrada, vire lead ou não (clids/rast_id já estão no raw).
  INSERT INTO public.external_form_submissions
    (clinic_id, name, phone, email, source, campaign, adset, ad, term, utm_source, raw)
  VALUES
    (p_clinic_id, p_name, p_phone, p_email, p_source, p_campaign, p_adset, p_ad, p_term, p_utm_source, p_raw)
  RETURNING id INTO v_sub_id;

  IF COALESCE(NULLIF(trim(p_phone), ''), NULLIF(trim(p_email), '')) IS NULL THEN
    RETURN jsonb_build_object('error', 'sem_identidade', 'submission_id', v_sub_id);
  END IF;

  v_nphone := normalize_br_phone(p_phone);

  -- Roteamento por origem: meta/instagram → fb_*; Google E o genérico (orgânico com UTM) → g_*.
  -- (Antes o genérico não gravava campanha em lugar nenhum; o n8n sempre gravou em g_* — paridade.)
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

  -- RETURNING NULL = a fn_handle_lead_uniqueness mesclou num lead existente (RETURN NULL do
  -- trigger BEFORE). Achar o alvo: por rast_id primeiro (é a chave mais forte), telefone depois.
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

revoke all on function public.ingest_external_form_lead(uuid, text, text, text, text, text, text, text, text, text, text, jsonb, text, text, text) from public, anon;
grant execute on function public.ingest_external_form_lead(uuid, text, text, text, text, text, text, text, text, text, text, jsonb, text, text, text) to service_role;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3) site_ingest_click roteia meta → fb_*
-- ═════════════════════════════════════════════════════════════════════════════
create or replace function public.site_ingest_click(
  p_clinic_id  uuid,
  p_source     text,
  p_g_clid     text default null,
  p_fb_clid    text default null,
  p_campaign   text default null,
  p_adset      text default null,
  p_ad         text default null,
  p_term       text default null,
  p_utm_source text default null,
  p_rast_id    text default null,
  p_raw        jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_proto   text;
  v_try     int := 0;
  v_is_meta boolean := (p_source in ('meta_ads','instagram'));
begin
  if p_clinic_id is null then
    raise exception 'clinic_id obrigatorio';
  end if;

  loop
    v_try := v_try + 1;
    v_proto := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');

    begin
      insert into public.attribution_inbox (
        clinic_id, phone, protocolo, source,
        g_clid, fb_clid,
        g_campaign_name, g_adset_name, g_ad_name, g_term_name, g_source_name,
        fb_campaign_name, fb_adset_name, fb_ad_name,
        rast_id, raw, occurred_at, external_id
      ) values (
        p_clinic_id, null, v_proto, nullif(p_source, ''),
        nullif(p_g_clid, ''), nullif(p_fb_clid, ''),
        case when not v_is_meta then nullif(p_campaign, '') end,
        case when not v_is_meta then nullif(p_adset, '') end,
        case when not v_is_meta then nullif(p_ad, '') end,
        case when not v_is_meta then nullif(p_term, '') end,
        nullif(p_utm_source, ''),
        case when v_is_meta then nullif(p_campaign, '') end,
        case when v_is_meta then nullif(p_adset, '') end,
        case when v_is_meta then nullif(p_ad, '') end,
        nullif(p_rast_id, ''), coalesce(p_raw, '{}'::jsonb), now(),
        'proto:' || v_proto
      );
      return v_proto;

    exception when unique_violation then
      if v_try >= 5 then
        raise exception 'nao consegui gerar protocolo unico apos % tentativas', v_try;
      end if;
    end;
  end loop;
end;
$$;

commit;

-- ============================================================================
-- ROLLBACK: recriar as versões de 20260714000013 (site_ingest_click sem fb_*)
-- e a ingest_external_form_lead de 12 parâmetros (sem clids/rast_id).
-- ============================================================================
