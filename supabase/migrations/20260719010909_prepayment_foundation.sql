-- 20260719010909_prepayment_foundation
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

alter table public.consultation_types
  add column if not exists requires_prepayment boolean not null default false,
  add column if not exists prepayment_amount numeric;
comment on column public.consultation_types.requires_prepayment is
  'Se true, a consulta desse tipo só é confirmada com pagamento antecipado.';
comment on column public.consultation_types.prepayment_amount is
  'Valor do pré-pagamento (R$). Se null, a clínica informa o valor manualmente.';

alter table public.ai_config
  add column if not exists payment_enabled boolean not null default false,
  add column if not exists payment_pix_key text,
  add column if not exists payment_pix_name text,
  add column if not exists payment_pix_bank text,
  add column if not exists payment_qr_url text,
  add column if not exists payment_card_link text,
  add column if not exists payment_instructions text;
comment on column public.ai_config.payment_enabled is
  'Master toggle do módulo de pagamento antecipado da clínica.';

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  ticket_id uuid,
  appointment_id uuid,
  consultation_type_id uuid,
  amount numeric,
  method text,
  status text not null default 'pendente',
  comprovante_path text,
  verdict text,
  verified_by text,
  verified_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.payments is
  'Fluxo de pré-pagamento por consulta (Fase 1: verificação IA+humano). Fonte da verdade p/ o gate do agendamento.';

create index if not exists idx_payments_clinic_status on public.payments (clinic_id, status);
create index if not exists idx_payments_lead on public.payments (lead_id) where lead_id is not null;
create index if not exists idx_payments_appointment on public.payments (appointment_id) where appointment_id is not null;

alter table public.payments enable row level security;

create policy payments_sel_clinic on public.payments
  for select using (
    ((clinic_id in (select cu.clinic_id from clinic_users cu where cu.id = auth.uid())) and is_clinic_active(clinic_id))
    or is_clinic_admin(clinic_id)
  );
create policy payments_sel_org on public.payments
  for select using (
    ((clinic_id in (
        select c.id from clinics c
        join org_users ou on ou.organization_id = c.organization_id
        where ou.user_id = auth.uid()
      )) and is_clinic_active(clinic_id))
    or is_clinic_admin(clinic_id)
  );

create or replace function public.fn_payments_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_payments_touch on public.payments;
create trigger trg_payments_touch before update on public.payments
  for each row execute function public.fn_payments_touch_updated_at();
