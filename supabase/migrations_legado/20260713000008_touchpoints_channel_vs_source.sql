-- Separa as duas dimensões da jornada, que eu havia misturado no mesmo campo.
--
--   CANAL  (por onde a pessoa falou):  site_forms | meta_forms | whatsapp | balcao
--   ORIGEM (o que a trouxe):           meta_ads | google_ads | instagram | NULL (orgânico)
--
-- Estava errado: gravei `channel='meta_ads'` (1.374 toques) e `channel='link'` (359). Mas
-- "meta_ads" é ORIGEM, não canal — quem clica no anúncio e cai no WhatsApp tem canal=whatsapp e
-- origem=meta_ads. Idem o link da bio: canal=whatsapp, origem=instagram.
-- Balcão é CANAL, nunca origem (origem é anúncio ou orgânico) — coerente com [[origin-balcao]].
--
-- Também fecha o buraco: 18.897 leads de WhatsApp não tinham toque NENHUM (jornada vazia na tela).
-- Passam a ter — só os novos; backfill dos antigos seria dado inventado (não sabemos a origem real,
-- só que mandaram mensagem).

begin;

-- ---------------------------------------------------------------------------
-- 1) Normaliza os toques já gravados
-- ---------------------------------------------------------------------------
-- CTWA: clicou no anúncio Meta -> abriu o WhatsApp. Canal é whatsapp; a origem já estava certa.
update public.lead_touchpoints
set channel = 'whatsapp'
where channel = 'meta_ads';

-- Link de redirecionamento: também desemboca no WhatsApp. O nome do link continua em
-- redirect_link_id, e o detail preserva o contexto ("bio", "story"...).
update public.lead_touchpoints
set channel = 'whatsapp'
where channel = 'link';

-- ---------------------------------------------------------------------------
-- 2) Triggers passam a gravar o canal correto
-- ---------------------------------------------------------------------------
create or replace function public.fn_touchpoint_from_link_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_source text;
begin
  if new.protocolo is null then
    return null;
  end if;

  select rl.lead_source into v_source from public.redirect_links rl where rl.id = new.redirect_link_id;

  if v_source is null then
    v_source := case when lower(coalesce(new.utm_source,'')) = 'instagram' then 'instagram' else null end;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, detail,
     external_ref, redirect_link_id, metadata)
  values
    (new.clinic_id, new.lead_id, new.rast_id, new.created_at,
     'whatsapp',                       -- o link desemboca no WhatsApp
     v_source,                         -- instagram / null (orgânico)
     new.utm_campaign, coalesce(new.utm_medium, 'link'), new.protocolo, new.redirect_link_id,
     jsonb_build_object('utm_source', new.utm_source, 'utm_content', new.utm_content))
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

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
    (clinic_id, lead_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.matched_lead_id, new.created_at,
     'whatsapp',                                  -- clicou no anúncio e caiu no WhatsApp
     coalesce(new.source, 'meta_ads'),            -- a origem é a campanha
     new.fb_campaign_name, new.fb_adset_name, new.fb_ad_name,
     'Clique no anúncio', new.ctwa_clid)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

-- Os triggers de claim referenciavam o canal antigo
create or replace function public.fn_touchpoint_link_session_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.lead_id is not null and old.lead_id is null then
    update public.lead_touchpoints
    set lead_id = new.lead_id
    where channel = 'whatsapp' and external_ref = new.protocolo and lead_id is null;
  end if;
  return null;
end;
$$;

create or replace function public.fn_touchpoint_ctwa_claimed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.matched_lead_id is not null and old.matched_lead_id is null and new.ctwa_clid is not null then
    update public.lead_touchpoints
    set lead_id = new.matched_lead_id
    where channel = 'whatsapp' and external_ref = new.ctwa_clid and lead_id is null;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) NOVO: WhatsApp direto / balcão / manual — leads que não tinham toque nenhum
--
-- Só cria o toque quando o lead NÃO traz clid de anúncio: se ele veio de campanha, o toque correto
-- (com a campanha) é criado pela inbox/CTWA, e duplicar aqui inventaria um contato "orgânico"
-- que nunca existiu.
-- ---------------------------------------------------------------------------
create or replace function public.fn_touchpoint_from_direct_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel text;
  v_detail  text;
begin
  v_channel := coalesce(new.capture_channel, 'whatsapp');

  -- forms tem trigger próprio (site_forms / meta_forms)
  if v_channel = 'forms' then
    return null;
  end if;

  -- Veio de anúncio? O toque virá com a campanha, pelo caminho do CTWA.
  if nullif(new.ctwa_clid,'') is not null
     or nullif(new.fb_clid,'') is not null
     or nullif(new.g_clid,'') is not null then
    return null;
  end if;

  v_detail := case v_channel
                when 'balcao' then 'Atendimento no balcão'
                when 'manual' then 'Cadastro manual'
                else 'Mandou mensagem no WhatsApp'
              end;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',   -- leads.created_at é SP sem tz
     v_channel,
     new.source,                                        -- NULL = orgânico (balcão nunca é origem)
     coalesce(new.fb_campaign_name, new.g_campaign_name),
     coalesce(new.fb_adset_name,    new.g_adset_name),
     coalesce(new.fb_ad_name,       new.g_ad_name),
     v_detail, new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

drop trigger if exists trg_touchpoint_direct_contact on public.leads;
create trigger trg_touchpoint_direct_contact
  after insert on public.leads
  for each row execute function public.fn_touchpoint_from_direct_contact();

commit;
