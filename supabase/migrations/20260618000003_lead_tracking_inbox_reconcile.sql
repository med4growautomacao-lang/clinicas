-- Corrige a race condition de atribuição de anúncio.
--
-- Problema: o fluxo n8n de tracking (CTWA/Meta) roda mais rápido que o fluxo que
-- cria o lead. Quando o nó "Inserir dados de Trackeamento" (update: row em leads)
-- executa, o lead ainda não existe -> o UPDATE não acha linha e a atribuição
-- (source/clid/campanha) se perde, gerando leads órfãos.
--
-- Solução: o n8n passa a gravar o tracking numa staging table (lead_tracking_inbox),
-- operação que sempre sucede. Dois triggers reconciliam a atribuição no lead em
-- qualquer ordem de chegada:
--   A) tracking chega depois do lead (caso normal) -> trigger na inbox acha o lead.
--   B) tracking chega antes do lead (o bug) -> ao criar o lead, trigger no leads
--      busca o tracking pendente mais recente e aplica.
--
-- Chave de junção: clinic_id + normalize_br_phone(phone) (reusa a função existente,
-- que resolve o 9º dígito). source deriva sozinho via tr_set_lead_source_from_tracking.

-- 1. Tabela de staging -------------------------------------------------------
create table if not exists public.lead_tracking_inbox (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  phone            text not null,
  phone_norm       text generated always as (public.normalize_br_phone(phone)) stored,
  source           text,
  ctwa_clid        text,
  fb_clid          text,
  g_clid           text,
  fb_campaign_name text,
  fb_adset_name    text,
  fb_ad_name       text,
  g_campaign_name  text,
  g_adset_name     text,
  g_ad_name        text,
  g_term_name      text,
  g_source_name    text,
  rast_id          text,
  raw              jsonb,                 -- payload bruto do webhook (auditoria)
  created_at       timestamptz not null default now(),
  consumed_at      timestamptz,
  matched_lead_id  uuid
);

comment on table public.lead_tracking_inbox is
  'Staging de tracking de anúncios (n8n grava aqui via service_role). Triggers reconciliam com leads. Ver migration 20260618000003.';

create index if not exists idx_lti_lookup
  on public.lead_tracking_inbox (clinic_id, phone_norm)
  where consumed_at is null;

-- service_role bypassa RLS; n8n usa service_role. Sem policies públicas.
alter table public.lead_tracking_inbox enable row level security;

-- 2. Função de aplicar (merge COALESCE — só preenche o que está nulo) ---------
create or replace function public.fn_apply_inbox_to_lead(p_lead_id uuid, p_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
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
$$;

-- 3. Trigger A — tracking chega (inbox -> lead) ------------------------------
create or replace function public.fn_inbox_reconcile()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead_id uuid;
begin
  if new.phone_norm is null then
    return null;
  end if;

  select id into v_lead_id
    from public.leads
   where clinic_id = new.clinic_id
     and public.normalize_br_phone(phone) = new.phone_norm
   order by created_at desc
   limit 1;

  if v_lead_id is not null then
    perform public.fn_apply_inbox_to_lead(v_lead_id, new.id);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_inbox_reconcile on public.lead_tracking_inbox;
create trigger trg_inbox_reconcile
  after insert on public.lead_tracking_inbox
  for each row execute function public.fn_inbox_reconcile();

-- 4. Trigger B — lead nasce (lead -> inbox) ----------------------------------
create or replace function public.fn_lead_pull_tracking()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inbox_id uuid;
begin
  -- já tem atribuição? não mexe (preserva first-touch / dados reais).
  if (new.source is not null and new.source <> '')
     or new.ctwa_clid is not null
     or new.fb_clid is not null
     or new.g_clid is not null then
    return null;
  end if;

  select id into v_inbox_id
    from public.lead_tracking_inbox
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
$$;

drop trigger if exists trg_lead_pull_tracking on public.leads;
create trigger trg_lead_pull_tracking
  after insert on public.leads
  for each row execute function public.fn_lead_pull_tracking();
