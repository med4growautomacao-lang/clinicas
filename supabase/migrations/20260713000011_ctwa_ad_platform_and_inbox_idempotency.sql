-- CTWA: plataforma real do anúncio (Instagram / Facebook / Status do WhatsApp) + idempotência da inbox.
--
-- MOTIVO (medido em 477 cliques CTWA, todas as instâncias, 06–13/07):
--
-- 1) PLATAFORMA. O WhatsApp já entrega `externalAdReply.sourceApp` em todo clique de anúncio, e nós
--    jogávamos fora. A distribuição real é **instagram 261 · facebook 173 · whatsapp 8**
--    (esse último é o "Anúncio no Status", uma colocação nova). Hoje todos viram `source='meta_ads'`
--    e a clínica não consegue responder "meu anúncio rende mais no Insta ou no Face?" — a informação
--    chegava de graça em todo clique.
--
--    A plataforma NÃO vira `source`. `source` continua sendo a ORIGEM (meta_ads / google_ads /
--    instagram / null=orgânico) — ver [[lead-journey-touchpoints]]. Misturar Instagram PAGO no
--    `source='instagram'` o confundiria com o link da bio, que é Instagram ORGÂNICO. Por isso
--    `ad_platform` é uma dimensão separada: a plataforma DENTRO do anúncio pago.
--
-- 2) IDEMPOTÊNCIA. `lead_tracking_inbox` não tem chave única — um retry do webhook (ou um replay
--    manual rodado duas vezes) duplica o clique em silêncio. Já aconteceu: **14 linhas duplicadas**
--    hoje na tabela. O `ctwa_clid` é único por clique na origem, então serve de chave natural.
--
-- NÃO É BUG (verificado, contra a minha própria suspeita inicial): os cliques com
-- `entryPointConversionSource` = `page_cta` / `click_to_chat_link` TÊM `sourceType='ad'` e um id de
-- anúncio real — são anúncios com outro ponto de entrada, não tráfego orgânico. Continuam pagos.

begin;

-- ---------------------------------------------------------------------------
-- 1) Coluna nova nas três tabelas da cadeia de atribuição
-- ---------------------------------------------------------------------------
alter table public.lead_tracking_inbox add column if not exists ad_platform text;
alter table public.leads              add column if not exists ad_platform text;
alter table public.lead_touchpoints   add column if not exists ad_platform text;

comment on column public.leads.ad_platform is
  'Plataforma DENTRO do anúncio pago (instagram/facebook/whatsapp), de externalAdReply.sourceApp. Não confundir com source (origem): um lead pode ser source=meta_ads + ad_platform=instagram.';

-- ---------------------------------------------------------------------------
-- 2) Deduplicar a inbox antes de travar a chave única
--    Mantém a linha mais rica (a que tem campanha) e, no empate, a mais antiga.
-- ---------------------------------------------------------------------------
create table if not exists public._inbox_dedup_20260713 as
select * from public.lead_tracking_inbox where false;

with ranked as (
  select id, clinic_id, ctwa_clid,
         row_number() over (
           partition by clinic_id, ctwa_clid
           order by (nullif(fb_campaign_name,'') is not null) desc, created_at asc
         ) as rn
  from public.lead_tracking_inbox
  where ctwa_clid is not null
),
mortos as (select id from ranked where rn > 1)
insert into public._inbox_dedup_20260713
select i.* from public.lead_tracking_inbox i join mortos m on m.id = i.id;

delete from public.lead_tracking_inbox i
using public._inbox_dedup_20260713 d
where i.id = d.id;

create unique index if not exists lead_tracking_inbox_ctwa_clid_uniq
  on public.lead_tracking_inbox (clinic_id, ctwa_clid)
  where ctwa_clid is not null;

-- ---------------------------------------------------------------------------
-- 3) Levar a plataforma da inbox para o lead
--    Mesmo COALESCE dos demais campos: o primeiro toque que trouxe atribuição manda.
-- ---------------------------------------------------------------------------
create or replace function public.fn_apply_inbox_to_lead(p_lead_id uuid, p_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  i public.lead_tracking_inbox%rowtype;
begin
  select * into i from public.lead_tracking_inbox where id = p_inbox_id;
  if not found then return; end if;

  update public.leads l set
    source           = coalesce(nullif(l.source, ''),           nullif(i.source, '')),
    ctwa_clid        = coalesce(nullif(l.ctwa_clid, ''),        nullif(i.ctwa_clid, '')),
    fb_clid          = coalesce(nullif(l.fb_clid, ''),          nullif(i.fb_clid, '')),
    g_clid           = coalesce(nullif(l.g_clid, ''),           nullif(i.g_clid, '')),
    fb_campaign_name = coalesce(nullif(l.fb_campaign_name, ''), nullif(i.fb_campaign_name, '')),
    fb_adset_name    = coalesce(nullif(l.fb_adset_name, ''),    nullif(i.fb_adset_name, '')),
    fb_ad_name       = coalesce(nullif(l.fb_ad_name, ''),       nullif(i.fb_ad_name, '')),
    ad_platform      = coalesce(nullif(l.ad_platform, ''),      nullif(i.ad_platform, '')),
    g_campaign_name  = coalesce(nullif(l.g_campaign_name, ''),  nullif(i.g_campaign_name, '')),
    g_adset_name     = coalesce(nullif(l.g_adset_name, ''),     nullif(i.g_adset_name, '')),
    g_ad_name        = coalesce(nullif(l.g_ad_name, ''),        nullif(i.g_ad_name, '')),
    g_term_name      = coalesce(nullif(l.g_term_name, ''),      nullif(i.g_term_name, '')),
    g_source_name    = coalesce(nullif(l.g_source_name, ''),    nullif(i.g_source_name, '')),
    rast_id          = coalesce(nullif(l.rast_id, ''),          nullif(i.rast_id, ''))
  where l.id = p_lead_id;

  update public.lead_tracking_inbox
     set consumed_at = now(), matched_lead_id = p_lead_id
   where id = p_inbox_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) E para o toque da jornada
-- ---------------------------------------------------------------------------
create or replace function public.fn_touchpoint_from_ctwa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ctwa_clid is null then
    return null;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, occurred_at, channel, source, campaign, adset, ad, ad_platform, detail, external_ref, metadata)
  values
    (new.clinic_id, new.matched_lead_id, new.created_at,
     'whatsapp',                                  -- clicou no anúncio e caiu no WhatsApp
     coalesce(new.source, 'meta_ads'),            -- a origem é a campanha
     new.fb_campaign_name, new.fb_adset_name, new.fb_ad_name,
     new.ad_platform,
     -- Quando o token da Meta está bloqueado não há nome de campanha; o título do criativo é a
     -- única pista legível que sobra, e ele vem do próprio WhatsApp.
     coalesce(nullif(new.raw->>'ad_title', ''), 'Clique no anúncio'),
     new.ctwa_clid,
     jsonb_strip_nulls(jsonb_build_object(
       'ad_title',  new.raw->>'ad_title',
       'ad_body',   new.raw->>'ad_body',
       'ad_url',    new.raw->>'ad_url',
       'source_id', new.raw->>'source_id'
     )))
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

commit;
