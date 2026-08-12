-- Convivência segura entre o n8n e a edge durante a comparação.
--
-- PROBLEMA: com o workflow "Tracking Meta" reativado, os DOIS gravam o mesmo clique. O
-- UNIQUE (clinic_id, external_id) impede a duplicata — mas quem perde a corrida é simplesmente
-- DESCARTADO. E os dois gravadores não gravam a mesma coisa:
--
--   n8n   → campanha/conjunto/anúncio (só isso; e só se a Graph API responder)
--   edge  → campanha + ad_platform + criativo + raw.source_id + ctwa_clid do Status
--
-- Ou seja: se o n8n vencer a corrida, o clique fica PARA SEMPRE sem plataforma, sem criativo e sem
-- `source_id` — e sem `source_id` o `ctwa-enrich` nem consegue resgatar a campanha depois. Ligar os
-- dois em paralelo DEGRADARIA o dado novo em vez de duplicá-lo.
--
-- FIX: a edge deixa de fazer INSERT seco e passa a chamar esta RPC, que faz UPSERT — se a linha já
-- existe (n8n chegou primeiro), ela COMPLETA o que falta em vez de ser descartada. E vice-versa: se
-- a edge chegou primeiro, o insert do n8n falha com 23505 e não estraga nada, porque a linha já tem
-- tudo. Assim a ordem de chegada deixa de importar.
--
-- Só preenche o que está VAZIO (COALESCE): o enriquecimento nunca sobrescreve dado bom.

begin;

create or replace function public.ctwa_ingest_click(
  p_clinic_id   uuid,
  p_phone       text,
  p_external_id text,
  p_ctwa_clid   text,
  p_campaign    text,
  p_adset       text,
  p_ad          text,
  p_ad_platform text,
  p_raw         jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id      uuid;
  v_lead_id uuid;
  v_novo    boolean;
begin
  insert into public.attribution_inbox as i (
    clinic_id, phone, source, ctwa_clid, external_id,
    fb_campaign_name, fb_adset_name, fb_ad_name, ad_platform, raw
  ) values (
    p_clinic_id, p_phone, 'meta_ads', p_ctwa_clid, p_external_id,
    p_campaign, p_adset, p_ad, p_ad_platform, p_raw
  )
  on conflict (clinic_id, external_id) where external_id is not null
  do update set
    ctwa_clid        = coalesce(nullif(i.ctwa_clid, ''),        nullif(excluded.ctwa_clid, '')),
    fb_campaign_name = coalesce(nullif(i.fb_campaign_name, ''), nullif(excluded.fb_campaign_name, '')),
    fb_adset_name    = coalesce(nullif(i.fb_adset_name, ''),    nullif(excluded.fb_adset_name, '')),
    fb_ad_name       = coalesce(nullif(i.fb_ad_name, ''),       nullif(excluded.fb_ad_name, '')),
    ad_platform      = coalesce(nullif(i.ad_platform, ''),      nullif(excluded.ad_platform, '')),
    -- `||` mescla os dois jsonb; o lado direito vence chave a chave, mas o n8n não grava `raw`,
    -- então na prática isto só ACRESCENTA o criativo/source_id da edge.
    raw              = coalesce(i.raw, '{}'::jsonb) || coalesce(excluded.raw, '{}'::jsonb)
  returning i.id, i.matched_lead_id, (xmax = 0) into v_id, v_lead_id, v_novo;

  -- Se o n8n chegou primeiro, o lead JÁ foi reconciliado — mas sem `ad_platform`, porque ele não
  -- conhece esse campo. O trigger de reconciliação só dispara no INSERT, então aqui reaplicamos
  -- explicitamente para o dado novo chegar ao lead e ao toque da jornada.
  if not v_novo and v_lead_id is not null then
    perform public.fn_apply_inbox_to_lead(v_lead_id, v_id);

    update public.lead_touchpoints t
       set ad_platform = coalesce(t.ad_platform, p_ad_platform),
           campaign    = coalesce(nullif(t.campaign, ''), nullif(p_campaign, '')),
           adset       = coalesce(nullif(t.adset, ''),    nullif(p_adset, '')),
           ad          = coalesce(nullif(t.ad, ''),       nullif(p_ad, ''))
     where t.channel = 'whatsapp' and t.external_ref = p_external_id;
  end if;

  return jsonb_build_object('id', v_id, 'inserted', v_novo);
end;
$function$;

revoke all on function public.ctwa_ingest_click(uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ctwa_ingest_click(uuid, text, text, text, text, text, text, text, jsonb) to service_role;

commit;
