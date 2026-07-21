-- Investimento por CAMPANHA (Fase 1) — tabela nova, paralela à marketing_data (que
-- CONTINUA sendo a fonte única do total agregado por conta; v_kpi_investment/painéis
-- não mudam). Grão: (clínica, data, plataforma, ad_platform, campanha, conjunto, anúncio).
-- ad_platform = rede dentro do Meta (facebook/instagram/audience_network/…), sempre
-- minúsculo (evita a inconsistência de caixa já vista em leads.ad_platform). Google não
-- tem essa dimensão nesta fase — grava ''.
-- adset_id/ad_id nasceram populáveis desde já (Fase 2 = anúncio) sem precisar de nova migration.
-- Colunas de dimensão são NOT NULL DEFAULT '' (nunca NULL) — NULL quebraria o UNIQUE de upsert
-- (NULL nunca "conflita" com NULL no Postgres).
-- (Aplicada em produção via MCP como 'marketing_spend_breakdown_table'.)
create table if not exists public.marketing_spend_breakdown (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  date date not null,
  platform text not null check (platform in ('meta_ads','google_ads')),
  ad_platform text not null default '',
  campaign_id text not null default '',
  campaign_name text not null default '',
  adset_id text not null default '',
  adset_name text not null default '',
  ad_id text not null default '',
  ad_name text not null default '',
  investment numeric not null default 0,
  created_at timestamp without time zone not null default now(),
  updated_at timestamp without time zone not null default now(),
  unique (clinic_id, date, platform, ad_platform, campaign_id, adset_id, ad_id)
);

create index if not exists idx_marketing_spend_breakdown_clinic_date
  on public.marketing_spend_breakdown (clinic_id, date);
create index if not exists idx_marketing_spend_breakdown_campaign
  on public.marketing_spend_breakdown (clinic_id, campaign_name);

alter table public.marketing_spend_breakdown enable row level security;

-- Só leitura para admin da clínica/super admin — escrita é 100% das edges (service role,
-- que ignora RLS). Não há entrada manual para esta tabela (diferente de marketing_data).
create policy marketing_spend_breakdown_read on public.marketing_spend_breakdown
  for select
  using (
    (clinic_id in (select clinic_users.clinic_id from public.clinic_users where clinic_users.id = auth.uid())
     and public.is_clinic_active(clinic_id))
    or public.is_clinic_admin(clinic_id)
    or public.is_super_admin()
  );

-- Auto-atualiza updated_at no upsert (facilita saber quando cada linha foi sincronizada por último).
create or replace function public.tg_marketing_spend_breakdown_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger trg_marketing_spend_breakdown_touch
  before update on public.marketing_spend_breakdown
  for each row execute function public.tg_marketing_spend_breakdown_touch();
