-- Resgate da campanha dos cliques que entraram com o token da Meta bloqueado.
--
-- A edge `ctwa-tracking` grava o clique mesmo quando a Graph API recusa o token — o lead fica
-- corretamente marcado como pago (source=meta_ads + ad_platform), só sem o NOME da campanha.
-- Como guardamos o `raw.source_id` (o id do anúncio), esse nome pode ser preenchido depois.
--
-- Esta RPC é o "depois". Ela recebe o que a Graph API devolveu e espalha para os três lugares que
-- precisam saber: o clique (inbox), o lead e o toque da jornada.
--
-- Só preenche o que está VAZIO (COALESCE): um enriquecimento tardio nunca sobrescreve uma campanha
-- que já estava correta — inclusive porque o lead pode ter recebido um clique mais novo no meio do
-- caminho, e o dado dele vale mais que o nosso resgate retroativo.

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
