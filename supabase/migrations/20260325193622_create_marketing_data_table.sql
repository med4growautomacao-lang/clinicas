-- 20260325193622_create_marketing_data_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create table public.marketing_data (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid references public.clinics(id) on delete cascade not null,
  date date not null,
  platform text not null check (platform in ('meta_ads', 'google_ads', 'no_track')),
  investment numeric default 0,
  conversions_value numeric default 0,
  manual_leads_count integer,
  manual_conversions_count integer,
  created_at timestamp with time zone default now(),
  unique(clinic_id, date, platform)
);

-- Enable RLS
alter table public.marketing_data enable row level security;

-- Policies
create policy "Clinics can view their own marketing data"
  on public.marketing_data for select
  using ( clinic_id = (select get_my_clinic_id()) );

create policy "Clinics can insert their own marketing data"
  on public.marketing_data for insert
  with check ( clinic_id = (select get_my_clinic_id()) );

create policy "Clinics can update their own marketing data"
  on public.marketing_data for update
  using ( clinic_id = (select get_my_clinic_id()) );

create policy "Super admins can do everything on marketing data"
  on public.marketing_data for all
  using ( (select is_admin()) );
