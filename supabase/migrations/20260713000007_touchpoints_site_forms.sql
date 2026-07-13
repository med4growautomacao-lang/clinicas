-- Canal `site_forms` na jornada: leads vindos do script instalado no site (WordPress).
--
-- Diferente dos outros canais, o formulário do site NÃO tem tabela de eventos própria — o lead É o
-- evento. Então o toque nasce do próprio INSERT em `leads` (capture_channel='forms').
--
-- RE-ENVIO: se a mesma pessoa preenche o formulário outra vez, fn_handle_lead_uniqueness faz merge
-- (UPDATE + RETURN NULL) e o 2º envio simplesmente desaparecia. Agora ele vira um toque — é
-- exatamente o tipo de contato que a jornada existe para mostrar.
--
-- Fuso: leads.created_at é `timestamp without time zone` na convenção São Paulo, e
-- lead_touchpoints.occurred_at é timestamptz. Sem o AT TIME ZONE, todo toque nasceria 3h deslocado.

begin;

-- ---------------------------------------------------------------------------
-- 1) Primeiro envio: o lead de forms nasce -> vira toque
-- ---------------------------------------------------------------------------
create or replace function public.fn_touchpoint_from_site_form()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.capture_channel, '') <> 'forms' then
    return null;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.id, new.rast_id,
     new.created_at at time zone 'America/Sao_Paulo',
     'site_forms', new.source,
     coalesce(new.g_campaign_name, new.fb_campaign_name),
     coalesce(new.g_adset_name,   new.fb_adset_name),
     coalesce(new.g_ad_name,      new.fb_ad_name),
     'Preencheu formulário', new.id::text)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

drop trigger if exists trg_touchpoint_site_form on public.leads;
create trigger trg_touchpoint_site_form
  after insert on public.leads
  for each row execute function public.fn_touchpoint_from_site_form();

-- ---------------------------------------------------------------------------
-- 2) Re-envio: o dedup mescla o lead, mas o CONTATO aconteceu e vai para a jornada.
--    Feito dentro de fn_handle_lead_uniqueness porque é lá (e só lá) que sabemos que o INSERT foi
--    absorvido por um lead existente. `external_ref` carimba o instante -> idempotente por envio.
-- ---------------------------------------------------------------------------
create or replace function public.fn_handle_lead_uniqueness()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
DECLARE v_existing_id uuid; v_nphone text; v_now timestamptz := now();
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
    UPDATE public.leads SET
      name = COALESCE(NULLIF(NEW.name, ''), name),
      phone = COALESCE(normalize_br_phone(NULLIF(NEW.phone, '')), phone),
      email = COALESCE(NULLIF(NEW.email, ''), email),
      source = COALESCE(NULLIF(NEW.source, ''), source),
      rast_id = COALESCE(NULLIF(rast_id, ''), NULLIF(NEW.rast_id, '')),
      g_clid = COALESCE(NULLIF(NEW.g_clid, ''), g_clid),
      g_campaign_name = COALESCE(NULLIF(NEW.g_campaign_name, ''), g_campaign_name),
      g_adset_name = COALESCE(NULLIF(NEW.g_adset_name, ''), g_adset_name),
      g_ad_name = COALESCE(NULLIF(NEW.g_ad_name, ''), g_ad_name),
      g_term_name = COALESCE(NULLIF(NEW.g_term_name, ''), g_term_name),
      g_source_name = COALESCE(NULLIF(NEW.g_source_name, ''), g_source_name),
      fb_clid = COALESCE(NULLIF(NEW.fb_clid, ''), fb_clid),
      fb_campaign_name = COALESCE(NULLIF(NEW.fb_campaign_name, ''), fb_campaign_name),
      fb_adset_name = COALESCE(NULLIF(NEW.fb_adset_name, ''), fb_adset_name),
      fb_ad_name = COALESCE(NULLIF(NEW.fb_ad_name, ''), fb_ad_name),
      ctwa_clid = COALESCE(NULLIF(NEW.ctwa_clid, ''), ctwa_clid),
      capture_channel = COALESCE(NULLIF(NEW.capture_channel, ''), capture_channel),
      updated_at = (now() AT TIME ZONE 'America/Sao_Paulo')
    WHERE id = v_existing_id;

    -- O merge preserva o first-touch (COALESCE) e descartaria este contato. Registramos o toque
    -- para que ele apareça na jornada com a campanha/origem DESTE envio, não a do primeiro.
    IF coalesce(NEW.capture_channel, '') = 'forms' THEN
      INSERT INTO public.lead_touchpoints
        (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
      VALUES
        (NEW.clinic_id, v_existing_id, NULLIF(NEW.rast_id, ''), v_now, 'site_forms', NEW.source,
         COALESCE(NEW.g_campaign_name, NEW.fb_campaign_name),
         COALESCE(NEW.g_adset_name,   NEW.fb_adset_name),
         COALESCE(NEW.g_ad_name,      NEW.fb_ad_name),
         'Preencheu formulário novamente',
         'resubmit:' || v_existing_id::text || ':' || extract(epoch from v_now)::bigint::text)
      ON CONFLICT (channel, external_ref) DO NOTHING;
    END IF;

    RETURN NULL;
  END IF;

  -- Lead NOVO: se nenhum canal trouxe identidade, geramos uma (UUID v4, formato do script do site).
  -- Depois das buscas: gerar antes faria o dedup nunca casar.
  IF NEW.rast_id IS NULL OR NEW.rast_id = '' THEN
    NEW.rast_id := gen_random_uuid()::text;
  END IF;

  RETURN NEW;
END; $function$;

-- ---------------------------------------------------------------------------
-- 3) Backfill dos leads de forms já existentes
-- ---------------------------------------------------------------------------
insert into public.lead_touchpoints
  (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
select l.clinic_id, l.id, l.rast_id,
       l.created_at at time zone 'America/Sao_Paulo',
       'site_forms', l.source,
       coalesce(l.g_campaign_name, l.fb_campaign_name),
       coalesce(l.g_adset_name,   l.fb_adset_name),
       coalesce(l.g_ad_name,      l.fb_ad_name),
       'Preencheu formulário', l.id::text
from public.leads l
where l.capture_channel = 'forms'
on conflict (channel, external_ref) do nothing;

commit;
