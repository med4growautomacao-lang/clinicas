-- Anúncio no Status do WhatsApp: a atribuição paga que estava sumindo por completo.
--
-- O Meta lançou a colocação "Anúncio no Status" e a Clínica São Lucas já está rodando. O clique
-- chega como qualquer CTWA — `externalAdReply` com `sourceID`, `title` e `sourceApp='whatsapp'` —
-- **mas SEM `ctwaClid`**. E tanto o n8n quanto a nossa edge exigiam o clid para gravar o clique.
--
-- Resultado: **8 leads reais da São Lucas** (06/06 a 13/07) entraram como WhatsApp ORGÂNICO,
-- quando são tráfego pago. E vai piorar sozinho conforme a colocação for adotada.
--
-- O `ctwa_clid` era usado como chave natural do clique (dedup + external_ref do toque). Sem clid,
-- precisamos de uma chave própria: `external_id`. Ela é o clid quando existe, e um id sintético
-- derivado do id da mensagem quando não existe (`wa_status:<messageid>`) — estável entre retries,
-- que é o que a idempotência exige.
--
-- `leads.ctwa_clid` continua NULO nesses casos, de propósito: inventar um clid falso mentiria para
-- qualquer integração futura que devolva o clid à Meta. O que marca o lead como pago é o
-- `source='meta_ads'` + `ad_platform='whatsapp'`, que é a verdade.

begin;

-- ---------------------------------------------------------------------------
-- 1) Chave do clique deixa de ser o clid e passa a ser `external_id`
-- ---------------------------------------------------------------------------
alter table public.lead_tracking_inbox add column if not exists external_id text;

comment on column public.lead_tracking_inbox.external_id is
  'Chave natural do clique: o ctwa_clid quando existe; wa_status:<messageid> para Anúncio no Status, que não gera clid.';

update public.lead_tracking_inbox
   set external_id = ctwa_clid
 where external_id is null and ctwa_clid is not null;

drop index if exists public.lead_tracking_inbox_ctwa_clid_uniq;

create unique index if not exists lead_tracking_inbox_external_id_uniq
  on public.lead_tracking_inbox (clinic_id, external_id)
  where external_id is not null;

-- ---------------------------------------------------------------------------
-- 2) O toque da jornada passa a nascer de qualquer clique de anúncio, com ou sem clid
-- ---------------------------------------------------------------------------
create or replace function public.fn_touchpoint_from_ctwa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := coalesce(new.external_id, new.ctwa_clid);
begin
  if v_ref is null then
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
     v_ref,
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

create or replace function public.fn_touchpoint_ctwa_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := coalesce(new.external_id, new.ctwa_clid);
begin
  if new.matched_lead_id is not null and old.matched_lead_id is null and v_ref is not null then
    update public.lead_touchpoints
       set lead_id = new.matched_lead_id
     where channel = 'whatsapp' and external_ref = v_ref and lead_id is null;
  end if;
  return null;
end;
$$;

commit;
