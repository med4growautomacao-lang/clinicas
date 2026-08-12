-- Jornada do lead: uma linha por TOQUE (ponto de contato), não uma por pessoa.
--
-- Por que uma tabela nova: `leads` é estruturalmente incapaz de guardar jornada. Ela tem uma linha
-- por pessoa e o merge de fn_handle_lead_uniqueness usa COALESCE — que por definição mantém o
-- primeiro toque e DESCARTA os seguintes. Pior: o COALESCE é campo a campo, então um 2º toque pode
-- deixar o lead com a origem do 1º e a campanha do 2º (mistura incoerente; 3 casos na Metaltres).
--
-- A jornada só é possível porque agora existe IDENTIDADE (rast_id UUID v4 em todo lead e em todo
-- clique — ver 20260713000004). É o rast_id que amarra os toques ANÔNIMOS: quem clicou 3x na bio
-- antes de mandar mensagem tem os 3 cliques ligados ao lead, e não só o que converteu.

begin;

create table if not exists public.lead_touchpoints (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  -- Fica NULL enquanto o toque é anônimo (clique sem conversa). É preenchido retroativamente
  -- quando a pessoa se identifica — é o coração da jornada.
  lead_id      uuid references public.leads(id) on delete cascade,
  rast_id      text,                    -- identidade do visitante: o elo entre os toques
  occurred_at  timestamptz not null,
  channel      text not null,           -- link | meta_ads | meta_forms | site_forms | whatsapp
  source       text,                    -- instagram | meta_ads | google_ads | null (orgânico)
  campaign     text,
  adset        text,
  ad           text,
  detail       text,                    -- utm_medium/protocolo/etc: contexto curto para a timeline
  -- Idempotência: cada toque tem uma referência única na origem (protocolo do clique, ctwa_clid,
  -- id do lead no Meta). Sem isto, um replay de trigger/backfill duplicaria a jornada.
  external_ref text not null,
  metadata     jsonb,
  created_at   timestamptz not null default now(),
  unique (channel, external_ref)
);

create index if not exists idx_touchpoints_lead    on public.lead_touchpoints (lead_id, occurred_at)
  where lead_id is not null;
create index if not exists idx_touchpoints_rast    on public.lead_touchpoints (clinic_id, rast_id)
  where rast_id is not null;
-- toques órfãos aguardando identificação (o sweep abaixo os procura)
create index if not exists idx_touchpoints_pending on public.lead_touchpoints (clinic_id, rast_id)
  where lead_id is null and rast_id is not null;

alter table public.lead_touchpoints enable row level security;

drop policy if exists lead_touchpoints_access on public.lead_touchpoints;
create policy lead_touchpoints_access on public.lead_touchpoints
  for all
  using (
    (clinic_id in (select clinic_users.clinic_id from clinic_users where clinic_users.id = auth.uid())
      and is_clinic_active(clinic_id))
    or (clinic_id in (select c.id from clinics c join org_users ou on ou.organization_id = c.organization_id
                       where ou.user_id = auth.uid()))
    or is_clinic_admin(clinic_id)
  )
  with check (
    (clinic_id in (select clinic_users.clinic_id from clinic_users where clinic_users.id = auth.uid())
      and is_clinic_active(clinic_id))
    or (clinic_id in (select c.id from clinics c join org_users ou on ou.organization_id = c.organization_id
                       where ou.user_id = auth.uid()))
    or is_clinic_admin(clinic_id)
  );

-- ---------------------------------------------------------------------------
-- Amarração retroativa: quando um lead ganha identidade, os toques anônimos daquela identidade
-- passam a ser dele. É isto que recupera os cliques anteriores à conversa.
-- ---------------------------------------------------------------------------
create or replace function public.fn_claim_touchpoints_for_lead(p_lead_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rast text;
  v_clinic uuid;
  v_n integer;
begin
  select rast_id, clinic_id into v_rast, v_clinic from public.leads where id = p_lead_id;
  if v_rast is null or v_rast = '' then
    return 0;
  end if;

  update public.lead_touchpoints t
  set lead_id = p_lead_id
  where t.clinic_id = v_clinic
    and t.rast_id = v_rast
    and t.lead_id is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Dispara sempre que o lead ganha/muda de identidade (inclusive quando o trigger do protocolo
-- substitui o UUID auto-gerado pela identidade real do visitante).
create or replace function public.fn_lead_claim_touchpoints()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.rast_id is not null and new.rast_id <> ''
     and (tg_op = 'INSERT' or new.rast_id is distinct from old.rast_id) then
    perform public.fn_claim_touchpoints_for_lead(new.id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_lead_claim_touchpoints on public.leads;
create trigger trg_lead_claim_touchpoints
  after insert or update of rast_id on public.leads
  for each row execute function public.fn_lead_claim_touchpoints();

-- ---------------------------------------------------------------------------
-- FONTE 1 — cliques no link de redirecionamento (bio/stories)
-- Registra o toque NO CLIQUE, mesmo anônimo. É a diferença entre "veio da bio" e
-- "clicou dia 3, voltou dia 8, conversou dia 12".
-- ---------------------------------------------------------------------------
create or replace function public.fn_touchpoint_from_link_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
begin
  if new.protocolo is null then
    return null;
  end if;

  select rl.lead_source into v_source
  from public.redirect_links rl where rl.id = new.redirect_link_id;

  if v_source is null then
    v_source := case when lower(coalesce(new.utm_source,'')) = 'instagram' then 'instagram' else null end;
  end if;

  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, detail, external_ref, metadata)
  values
    (new.clinic_id, new.lead_id, new.rast_id, new.created_at, 'link', v_source,
     new.utm_campaign, coalesce(new.utm_medium, 'link'), new.protocolo,
     jsonb_build_object('utm_source', new.utm_source, 'utm_content', new.utm_content))
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

drop trigger if exists trg_touchpoint_link_session on public.link_sessions;
create trigger trg_touchpoint_link_session
  after insert on public.link_sessions
  for each row execute function public.fn_touchpoint_from_link_session();

-- Quando o clique fecha (a pessoa mandou a mensagem), o toque passa a apontar para o lead.
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
    where channel = 'link' and external_ref = new.protocolo and lead_id is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_touchpoint_link_claimed on public.link_sessions;
create trigger trg_touchpoint_link_claimed
  after update of lead_id on public.link_sessions
  for each row execute function public.fn_touchpoint_link_session_claimed();

-- ---------------------------------------------------------------------------
-- FONTE 2 — anúncio Meta que abre o WhatsApp (CTWA)
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
    (clinic_id, lead_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref)
  values
    (new.clinic_id, new.matched_lead_id, new.created_at, 'meta_ads',
     coalesce(new.source, 'meta_ads'), new.fb_campaign_name, new.fb_adset_name, new.fb_ad_name,
     'Clique no anúncio', new.ctwa_clid)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

drop trigger if exists trg_touchpoint_ctwa on public.lead_tracking_inbox;
create trigger trg_touchpoint_ctwa
  after insert on public.lead_tracking_inbox
  for each row execute function public.fn_touchpoint_from_ctwa();

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
    where channel = 'meta_ads' and external_ref = new.ctwa_clid and lead_id is null;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_touchpoint_ctwa_claimed on public.lead_tracking_inbox;
create trigger trg_touchpoint_ctwa_claimed
  after update of matched_lead_id on public.lead_tracking_inbox
  for each row execute function public.fn_touchpoint_ctwa_claimed();

-- ---------------------------------------------------------------------------
-- FONTE 3 — Formulário nativo do Meta
-- ---------------------------------------------------------------------------
create or replace function public.fn_touchpoint_from_meta_form()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.lead_touchpoints
    (clinic_id, lead_id, rast_id, occurred_at, channel, source, campaign, adset, ad, detail, external_ref, metadata)
  values
    (new.clinic_id, new.lead_id, new.rast_id, new.submitted_at, 'meta_forms',
     coalesce(new.source, 'meta_ads'), new.fb_campaign_name, new.fb_adset_name, new.fb_ad_name,
     'Preencheu formulário', new.external_id, new.payload)
  on conflict (channel, external_ref) do nothing;

  return null;
end;
$$;

drop trigger if exists trg_touchpoint_meta_form on public.lead_tracking;
create trigger trg_touchpoint_meta_form
  after insert on public.lead_tracking
  for each row execute function public.fn_touchpoint_from_meta_form();

-- ---------------------------------------------------------------------------
-- A jornada, pronta para a tela
-- ---------------------------------------------------------------------------
create or replace function public.get_lead_journey(p_lead_id uuid)
returns table (
  occurred_at timestamptz,
  channel     text,
  source      text,
  campaign    text,
  adset       text,
  ad          text,
  detail      text,
  is_conversion boolean   -- o toque em que a pessoa efetivamente falou com a clínica
)
language sql
stable
security invoker   -- respeita a RLS de lead_touchpoints (isolamento por clínica)
as $$
  select
    t.occurred_at, t.channel, t.source, t.campaign, t.adset, t.ad, t.detail,
    exists (
      select 1 from public.link_sessions ls
      where ls.protocolo = t.external_ref and ls.used_at is not null
    ) or t.channel in ('meta_forms')  as is_conversion
  from public.lead_touchpoints t
  where t.lead_id = p_lead_id
  order by t.occurred_at asc;
$$;

revoke all on function public.get_lead_journey(uuid) from public, anon;
grant execute on function public.get_lead_journey(uuid) to authenticated;

commit;
