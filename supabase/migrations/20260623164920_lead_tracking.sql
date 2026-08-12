-- 20260623164920_lead_tracking
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create table if not exists public.lead_tracking (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  lead_id          uuid references public.leads(id) on delete set null,
  channel          text not null,
  external_id      text,
  name             text,
  phone            text,
  phone_norm       text generated always as (public.normalize_br_phone(phone)) stored,
  email            text,
  source           text,
  rast_id          text,
  fb_campaign_name text,
  fb_adset_name    text,
  fb_ad_name       text,
  submitted_at     timestamptz,
  payload          jsonb,
  created_at       timestamptz not null default now()
);

comment on table public.lead_tracking is
  'Tracking canônico por pessoa/canal (Fase 1: só captação Meta Lead Ads; dual-write em leads). Dedup por (channel, external_id). Ver migration 20260623000002.';

alter table public.lead_tracking enable row level security;

create unique index if not exists uq_lead_tracking_channel_external
  on public.lead_tracking (channel, external_id);

create index if not exists idx_lead_tracking_clinic_phone
  on public.lead_tracking (clinic_id, phone_norm);

create index if not exists idx_lead_tracking_lead
  on public.lead_tracking (lead_id);
