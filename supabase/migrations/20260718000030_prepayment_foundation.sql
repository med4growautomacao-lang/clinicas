-- Pagamento antecipado — FUNDAÇÃO (Fase 1: IA envia dados + humano confere o comprovante).
-- Escopo POR TIPO DE CONSULTA. financial_transactions é razão contábil; aqui precisamos de
-- uma máquina de estado do pré-pagamento (pendente → comprovante → pago/recusado) + o
-- comprovante + o veredito. Daí a tabela payments dedicada.

-- 1) Quais tipos de consulta exigem pré-pagamento (e quanto)
alter table public.consultation_types
  add column if not exists requires_prepayment boolean not null default false,
  add column if not exists prepayment_amount numeric;
comment on column public.consultation_types.requires_prepayment is
  'Se true, a consulta desse tipo só é confirmada com pagamento antecipado.';
comment on column public.consultation_types.prepayment_amount is
  'Valor do pré-pagamento (R$). Se null, a clínica informa o valor manualmente.';

-- 2) Dados de pagamento da CLÍNICA (a conta PIX / link de cartão são da clínica, não do tipo)
alter table public.ai_config
  add column if not exists payment_enabled boolean not null default false,
  add column if not exists payment_pix_key text,
  add column if not exists payment_pix_name text,
  add column if not exists payment_pix_bank text,
  add column if not exists payment_qr_url text,          -- URL pública do QR (enviada ao paciente)
  add column if not exists payment_card_link text,
  add column if not exists payment_instructions text;    -- template da mensagem c/ os dados
comment on column public.ai_config.payment_enabled is
  'Master toggle do módulo de pagamento antecipado da clínica.';

-- 3) Máquina de estado do pré-pagamento
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  ticket_id uuid,
  appointment_id uuid,
  consultation_type_id uuid,
  amount numeric,
  method text,                                    -- pix | cartao | null
  status text not null default 'pendente',        -- pendente | comprovante_recebido | pago | recusado
  comprovante_path text,                          -- path no bucket (imagem/pdf do comprovante)
  verdict text,                                   -- leitura da IA (valor/destinatário/observação)
  verified_by text,                               -- ia | humano | psp
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

-- SELECT espelha leads (clinic_users + org_users + is_clinic_admin). Escrita via funções/service_role.
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

-- updated_at automático
create or replace function public.fn_payments_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists trg_payments_touch on public.payments;
create trigger trg_payments_touch before update on public.payments
  for each row execute function public.fn_payments_touch_updated_at();
