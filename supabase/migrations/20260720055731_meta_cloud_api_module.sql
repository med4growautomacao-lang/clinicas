-- 20260720055731_meta_cloud_api_module
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Módulo "API Oficial Meta" (WhatsApp Cloud API oficial / Tech Provider).
-- 4 tabelas, todas escopadas por clinic_id, RLS = is_clinic_admin(clinic_id) OR is_super_admin().
-- Segredo (token/WABA de plataforma) NÃO mora aqui — vive em secret de edge. Nenhuma coluna
-- desta migração carrega credencial sensível (waba_id é id público; sem access token).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Canais oficiais por cliente (o "remetente"). Só phone_number_id + display.
create table if not exists public.meta_cloud_channels (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  label            text,
  phone_display    text,                       -- DDD+número, cosmético (WABA OFICIAL na UI)
  phone_number_id  text not null,              -- id do número na Cloud API (POST .../messages)
  waba_id          text,                       -- override opcional; null => usa a WABA de plataforma (env)
  status           text not null default 'connected' check (status in ('connected','disconnected')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (clinic_id, phone_number_id)
);
create index if not exists idx_meta_cloud_channels_clinic on public.meta_cloud_channels(clinic_id);

-- 2) Espelho dos templates da Meta (status vem da Graph API / webhook).
create table if not exists public.meta_cloud_templates (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  channel_id        uuid references public.meta_cloud_channels(id) on delete set null,
  meta_template_id  text,
  name              text not null,
  language          text not null default 'pt_BR',
  category          text not null default 'MARKETING' check (category in ('MARKETING','UTILITY','AUTHENTICATION')),
  body_text         text,
  components         jsonb,
  status            text not null default 'PENDING',  -- PENDING/APPROVED/REJECTED/...
  rejected_reason   text,
  created_at        timestamptz not null default now(),
  synced_at         timestamptz,
  unique (clinic_id, name, language)
);
create index if not exists idx_meta_cloud_templates_clinic on public.meta_cloud_templates(clinic_id);

-- 3) Histórico de disparos (outbound).
create table if not exists public.meta_cloud_sends (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics(id) on delete cascade,
  channel_id     uuid references public.meta_cloud_channels(id) on delete set null,
  template_name  text,
  to_phone       text not null,
  wamid          text,                          -- id da mensagem na Meta (casa com statuses do webhook)
  status         text not null default 'sent' check (status in ('sent','delivered','read','failed')),
  error          jsonb,
  sent_by        uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_meta_cloud_sends_clinic on public.meta_cloud_sends(clinic_id, created_at desc);
create index if not exists idx_meta_cloud_sends_wamid on public.meta_cloud_sends(wamid) where wamid is not null;

-- 4) Log cru dos eventos da callback (inbound + status + template status).
create table if not exists public.meta_cloud_events (
  id               uuid primary key default gen_random_uuid(),
  phone_number_id  text,
  channel_id       uuid references public.meta_cloud_channels(id) on delete set null,
  clinic_id        uuid references public.clinics(id) on delete cascade,
  event_type       text not null default 'other' check (event_type in ('message','status','template_status','other')),
  from_phone       text,
  wamid            text,
  payload          jsonb not null,
  received_at      timestamptz not null default now()
);
create index if not exists idx_meta_cloud_events_clinic on public.meta_cloud_events(clinic_id, received_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
alter table public.meta_cloud_channels  enable row level security;
alter table public.meta_cloud_templates enable row level security;
alter table public.meta_cloud_sends     enable row level security;
alter table public.meta_cloud_events    enable row level security;

-- Canais: clinic admin (ou super) gerencia por completo (sem segredo na linha).
create policy meta_cloud_channels_rw on public.meta_cloud_channels
  for all to authenticated
  using (public.is_clinic_admin(clinic_id) or public.is_super_admin())
  with check (public.is_clinic_admin(clinic_id) or public.is_super_admin());

-- Templates: só leitura pelo frontend (escrita é service role via edge).
create policy meta_cloud_templates_ro on public.meta_cloud_templates
  for select to authenticated
  using (public.is_clinic_admin(clinic_id) or public.is_super_admin());

-- Sends: só leitura pelo frontend.
create policy meta_cloud_sends_ro on public.meta_cloud_sends
  for select to authenticated
  using (public.is_clinic_admin(clinic_id) or public.is_super_admin());

-- Events: só leitura; super vê inclusive os não-resolvidos (clinic_id null).
create policy meta_cloud_events_ro on public.meta_cloud_events
  for select to authenticated
  using ((clinic_id is not null and public.is_clinic_admin(clinic_id)) or public.is_super_admin());

-- Grants (RLS faz o gate de linha; service_role bypassa RLS e escreve tudo).
grant select, insert, update, delete on public.meta_cloud_channels to authenticated;
grant select on public.meta_cloud_templates to authenticated;
grant select on public.meta_cloud_sends to authenticated;
grant select on public.meta_cloud_events to authenticated;
grant all on public.meta_cloud_channels, public.meta_cloud_templates, public.meta_cloud_sends, public.meta_cloud_events to service_role;
