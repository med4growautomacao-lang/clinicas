-- 20260727222705_20260727192646_meta_custom_conversions_tables
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Conversões personalizadas do Meta no painel de Marketing.
-- Até aqui só o INVESTIMENTO era sincronizado (marketing_spend_breakdown); as conversões
-- personalizadas (Compra do produto X, página de obrigado Y…) existiam só na API do Meta, então
-- não davam para virar coluna da tabela. São DUAS tabelas de propósito:
--   1) catálogo (id -> nome) — o insights devolve só o ID dentro de action_type
--      ("offsite_conversion.custom.<id>"); o nome vem do endpoint /customconversions.
--   2) fato diário por campanha/conjunto/anúncio — relação 1:N com a campanha (várias conversões
--      por linha), por isso NÃO cabe em marketing_spend_breakdown.

-- 1) Catálogo por clínica
create table if not exists public.meta_custom_conversions (
  clinic_id        uuid not null references public.clinics(id) on delete cascade,
  conversion_id    text not null,
  name             text,
  custom_event_type text,
  is_archived      boolean not null default false,
  last_fired_at    timestamptz,
  synced_at        timestamptz not null default now(),
  primary key (clinic_id, conversion_id)
);

-- 2) Fato diário (mesma granularidade do spend breakdown + a conversão)
create table if not exists public.marketing_conversions_breakdown (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  date          date not null,
  platform      text not null default 'meta_ads',
  campaign_id   text, campaign_name text,
  adset_id      text, adset_name   text,
  ad_id         text, ad_name      text,
  conversion_id text not null,
  conversions   numeric not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Chave de idempotência do upsert diário. COALESCE nos ids porque o Meta pode devolver linha
-- sem adset/ad (campanha Advantage+); NULL não colide em unique, o que duplicaria a cada sync.
create unique index if not exists uq_mkt_conv_breakdown
  on public.marketing_conversions_breakdown
     (clinic_id, date, platform, coalesce(campaign_id,''), coalesce(adset_id,''),
      coalesce(ad_id,''), conversion_id);

create index if not exists idx_mkt_conv_breakdown_clinic_date
  on public.marketing_conversions_breakdown (clinic_id, date);

-- RLS: mesma régua barata de leads/tickets (my_clinic_ids() sem argumento resolve 1x por query,
-- ver memória rls-my-clinic-ids-set-based). Escrita é do service_role (edge), que faz bypass.
alter table public.meta_custom_conversions enable row level security;
alter table public.marketing_conversions_breakdown enable row level security;

drop policy if exists meta_custom_conversions_read on public.meta_custom_conversions;
create policy meta_custom_conversions_read on public.meta_custom_conversions
  for select using (
    clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin())
  );

drop policy if exists marketing_conversions_breakdown_read on public.marketing_conversions_breakdown;
create policy marketing_conversions_breakdown_read on public.marketing_conversions_breakdown
  for select using (
    clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin())
  );
