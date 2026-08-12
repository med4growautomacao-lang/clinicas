-- 20260713200127_fix_site_forms_touchpoint_duplicates_meta
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- BUG: capture_channel='forms' é usado TANTO pelo formulário do site QUANTO pelo Meta Forms nativo
-- (ingest_meta_form_lead também grava 'forms'). O trigger de site_forms não distinguia e criava um
-- toque duplicado: o mesmo preenchimento aparecia 2x na jornada (site_forms + meta_forms, mesmo
-- segundo, mesma campanha) — visto na Faggioni (Erlane, Rosana, Selma).
--
-- Guarda: a RPC insere em lead_tracking ANTES de criar o lead (verificado), então no momento do
-- trigger já dá para saber que aquele lead veio do Meta Forms — e aí o toque correto é o
-- 'meta_forms', criado pelo trigger de lead_tracking.

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

  -- Veio do Formulário Nativo do Meta? Então não é "formulário do site".
  if exists (
    select 1 from public.lead_tracking lt
    where lt.clinic_id = new.clinic_id
      and lt.channel = 'meta_forms'
      and (
        (nullif(new.rast_id, '') is not null and lt.rast_id = new.rast_id)
        or (lt.phone_norm is not null and lt.phone_norm = normalize_br_phone(new.phone))
      )
  ) then
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

-- Limpa os toques espúrios já criados (o mesmo preenchimento contado 2x).
create table if not exists public._deleted_dup_site_forms_touchpoints_20260713 as
select * from public.lead_touchpoints sf
where sf.channel = 'site_forms'
  and exists (
    select 1 from public.lead_touchpoints mf
    where mf.channel = 'meta_forms'
      and mf.lead_id = sf.lead_id
      and abs(extract(epoch from (mf.occurred_at - sf.occurred_at))) < 300
  );

delete from public.lead_touchpoints sf
where sf.channel = 'site_forms'
  and exists (
    select 1 from public.lead_touchpoints mf
    where mf.channel = 'meta_forms'
      and mf.lead_id = sf.lead_id
      and abs(extract(epoch from (mf.occurred_at - sf.occurred_at))) < 300
  );
