-- Tabela canônica de tracking por pessoa/canal (início da centralização — Fase 1).
--
-- Contexto: hoje a atribuição (source/rast_id/fb_*/g_*/ctwa_clid) vive espalhada em colunas da
-- tabela `leads`, lida por ~31 funções SQL (Comercial/Marketing/funis) e 7 telas. Estamos
-- começando a mover isso para uma tabela própria, de forma INCREMENTAL: a tabela nasce agora e o
-- poller do Meta (captação de Lead Ads nativo) já grava aqui, MAS continuamos denormalizando a
-- atribuição em `leads` (dual-write) para não quebrar os painéis. A migração dos leitores + drop
-- das colunas de `leads` é Fase 2.
--
-- `lead_tracking_inbox` NÃO serve para isto: ela é staging (decora um lead que nasce noutro lugar,
-- casando por telefone, com consumed_at/reconcile). Aqui a submissão do canal É a origem do lead.
--
-- Chave de deduplicação do canal: (channel, external_id). Para 'meta_forms', external_id = o `id`
-- do lead retornado pela Graph API (estável e único por submissão). NÃO usamos rast_id como chave:
-- na produção o rast_id (UUID do site) se repete entre pessoas (id por navegador/cookie).

create table if not exists public.lead_tracking (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  lead_id          uuid references public.leads(id) on delete set null,
  channel          text not null,                       -- 'meta_forms' (futuro: forms/whatsapp/google)
  external_id      text,                                -- id do lead no canal (Meta lead.id) — dedup
  name             text,
  phone            text,
  phone_norm       text generated always as (public.normalize_br_phone(phone)) stored,
  email            text,
  source           text,                                -- ex.: 'meta_ads'
  rast_id          text,                                -- token de atribuição (UUID), espelha leads.rast_id
  fb_campaign_name text,
  fb_adset_name    text,
  fb_ad_name       text,
  submitted_at     timestamptz,                         -- horário do evento no canal (FB created_time)
  payload          jsonb,                               -- dados específicos do canal (perguntas/respostas)
  created_at       timestamptz not null default now()
);

comment on table public.lead_tracking is
  'Tracking canônico por pessoa/canal (Fase 1: só captação Meta Lead Ads; dual-write em leads). Dedup por (channel, external_id). Ver migration 20260623000002.';

-- service_role bypassa RLS (Edge Function/RPC usam service_role). Sem policies públicas.
alter table public.lead_tracking enable row level security;

-- Dedup do canal: nulls não conflitam, então linhas sem external_id são permitidas.
create unique index if not exists uq_lead_tracking_channel_external
  on public.lead_tracking (channel, external_id);

create index if not exists idx_lead_tracking_clinic_phone
  on public.lead_tracking (clinic_id, phone_norm);

create index if not exists idx_lead_tracking_lead
  on public.lead_tracking (lead_id);
