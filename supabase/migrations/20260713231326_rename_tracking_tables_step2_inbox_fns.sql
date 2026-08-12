-- 20260713231326_rename_tracking_tables_step2_inbox_fns
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

create or replace function public.fn_apply_inbox_to_lead(p_lead_id uuid, p_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  i public.attribution_inbox%rowtype;
begin
  select * into i from public.attribution_inbox where id = p_inbox_id;
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

  update public.attribution_inbox
     set consumed_at = now(), matched_lead_id = p_lead_id
   where id = p_inbox_id;
end;
$function$;

create or replace function public.fn_lead_pull_tracking()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_inbox_id uuid;
begin
  if (new.source is not null and new.source <> '')
     or new.ctwa_clid is not null
     or new.fb_clid is not null
     or new.g_clid is not null then
    return null;
  end if;

  select id into v_inbox_id
    from public.attribution_inbox
   where clinic_id = new.clinic_id
     and phone_norm = public.normalize_br_phone(new.phone)
     and consumed_at is null
   order by created_at desc
   limit 1;

  if v_inbox_id is not null then
    perform public.fn_apply_inbox_to_lead(new.id, v_inbox_id);
  end if;

  return null;
end;
$function$;

create or replace function public.fn_reconcile_pending_tracking()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT i.id AS inbox_id,
      (SELECT l.id FROM leads l
        WHERE l.clinic_id = i.clinic_id AND normalize_br_phone(l.phone) = i.phone_norm
        ORDER BY l.created_at DESC LIMIT 1) AS lead_id
    FROM attribution_inbox i
    WHERE i.consumed_at IS NULL AND i.phone_norm IS NOT NULL
  LOOP
    IF r.lead_id IS NOT NULL THEN
      PERFORM public.fn_apply_inbox_to_lead(r.lead_id, r.inbox_id);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;

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
  i public.attribution_inbox%rowtype;
begin
  update public.attribution_inbox
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

commit;
