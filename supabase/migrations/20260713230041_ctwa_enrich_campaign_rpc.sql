-- 20260713230041_ctwa_enrich_campaign_rpc
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

create or replace function public.ctwa_enrich_campaign(
  p_inbox_id  uuid,
  p_campaign  text,
  p_adset     text,
  p_ad        text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  i public.lead_tracking_inbox%rowtype;
begin
  update public.lead_tracking_inbox
     set fb_campaign_name = coalesce(nullif(fb_campaign_name, ''), nullif(p_campaign, '')),
         fb_adset_name    = coalesce(nullif(fb_adset_name, ''),    nullif(p_adset, '')),
         fb_ad_name       = coalesce(nullif(fb_ad_name, ''),       nullif(p_ad, ''))
   where id = p_inbox_id
  returning * into i;

  if not found then return; end if;

  if i.matched_lead_id is not null then
    update public.leads l
       set fb_campaign_name = coalesce(nullif(l.fb_campaign_name, ''), nullif(i.fb_campaign_name, '')),
           fb_adset_name    = coalesce(nullif(l.fb_adset_name, ''),    nullif(i.fb_adset_name, '')),
           fb_ad_name       = coalesce(nullif(l.fb_ad_name, ''),       nullif(i.fb_ad_name, ''))
     where l.id = i.matched_lead_id;
  end if;

  update public.lead_touchpoints t
     set campaign = coalesce(nullif(t.campaign, ''), nullif(i.fb_campaign_name, '')),
         adset    = coalesce(nullif(t.adset, ''),    nullif(i.fb_adset_name, '')),
         ad       = coalesce(nullif(t.ad, ''),       nullif(i.fb_ad_name, ''))
   where t.channel = 'whatsapp'
     and t.external_ref = coalesce(i.external_id, i.ctwa_clid);
end;
$function$;

revoke all on function public.ctwa_enrich_campaign(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.ctwa_enrich_campaign(uuid, text, text, text) to service_role;

commit;
