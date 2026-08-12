-- 20260714015905_ctwa_ingest_click_upsert
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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
    raw              = coalesce(i.raw, '{}'::jsonb) || coalesce(excluded.raw, '{}'::jsonb)
  returning i.id, i.matched_lead_id, (xmax = 0) into v_id, v_lead_id, v_novo;

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
