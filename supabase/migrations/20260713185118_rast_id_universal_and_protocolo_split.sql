-- 20260713185118_rast_id_universal_and_protocolo_split
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create or replace function public.fn_handle_lead_uniqueness()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
DECLARE v_existing_id uuid; v_nphone text;
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
    RETURN NULL;
  END IF;

  IF NEW.rast_id IS NULL OR NEW.rast_id = '' THEN
    NEW.rast_id := gen_random_uuid()::text;
  END IF;

  RETURN NEW;
END; $function$;

create unique index if not exists uq_leads_clinic_rast_id
  on public.leads (clinic_id, rast_id) where rast_id is not null;

update public.link_sessions
set protocolo = rast_id
where protocolo is null and rast_id is not null;

create unique index if not exists uq_link_sessions_protocolo on public.link_sessions (protocolo);
create index if not exists idx_link_sessions_open_proto
  on public.link_sessions (clinic_id, protocolo) where used_at is null;

alter table public.link_sessions drop constraint if exists link_sessions_rast_id_key;
create index if not exists idx_link_sessions_visitor on public.link_sessions (clinic_id, rast_id)
  where rast_id is not null;

create or replace function public.fn_close_redirect_protocol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proto   text;
  v_session public.link_sessions%rowtype;
  v_source  text;
begin
  if new.direction is distinct from 'inbound' or new.lead_id is null then
    return new;
  end if;

  v_proto := (regexp_match(coalesce(new.message->>'content', ''), '[Pp]rotocolo:?\s*(\d+)'))[1];
  if v_proto is null then
    return new;
  end if;

  select * into v_session
  from public.link_sessions ls
  where coalesce(ls.protocolo, ls.rast_id) = v_proto
    and ls.clinic_id = new.clinic_id
    and ls.used_at is null
    and ls.created_at > now() - interval '30 days'
  limit 1;

  if not found then
    return new;
  end if;

  select rl.lead_source into v_source
  from public.redirect_links rl
  where rl.id = v_session.redirect_link_id;

  if v_source is null then
    v_source := case
                  when lower(coalesce(v_session.utm_source, '')) = 'instagram' then 'instagram'
                  else null
                end;
  end if;

  update public.leads l
  set source  = coalesce(nullif(l.source, ''), v_source),
      rast_id = coalesce(nullif(l.rast_id, ''), nullif(v_session.rast_id, ''))
  where l.id = new.lead_id
    and l.ctwa_clid is null
    and l.fb_clid   is null
    and l.g_clid    is null;

  update public.link_sessions
  set used_at = now(),
      lead_id = new.lead_id
  where id = v_session.id
    and used_at is null;

  return new;
end;
$$;
