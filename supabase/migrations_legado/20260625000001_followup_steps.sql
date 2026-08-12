-- Drip de reengajamento: sequência de passos por clínica (mensagem + delay próprios por passo).
-- Substitui o trio ai_config.followup_message/followup_delay/followup_max_attempts (que vira
-- deprecado). Backfill 1:1 replica o comportamento atual (N passos iguais = followup_max_attempts).

create table if not exists public.followup_steps (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics(id) on delete cascade,
  step_no       int  not null,                 -- 1,2,3...
  message_text  text not null,                 -- multi-balão via \n\n
  delay_minutes int  not null,                 -- inatividade/espaçamento DESTE passo
  enabled       boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, step_no)
);

comment on table public.followup_steps is
  'Régua de reengajamento (drip) por clínica. step_no ordena; delay_minutes = inatividade do passo. Ver migration 20260625000001.';

create index if not exists idx_followup_steps_clinic on public.followup_steps (clinic_id, step_no);

drop trigger if exists tr_followup_steps_updated_at on public.followup_steps;
create trigger tr_followup_steps_updated_at
  before update on public.followup_steps
  for each row execute function public.handle_updated_at();

-- RLS: mesmo padrão de funnel_stages (clinic_users + org_users). service_role/cron bypassa.
alter table public.followup_steps enable row level security;

drop policy if exists followup_steps_all on public.followup_steps;
create policy followup_steps_all on public.followup_steps for all
  using (
    ((clinic_id in (select clinic_users.clinic_id from public.clinic_users where clinic_users.id = auth.uid()))
      and public.is_clinic_active(clinic_id))
    or public.is_clinic_admin(clinic_id)
  );

drop policy if exists followup_steps_org_access on public.followup_steps;
create policy followup_steps_org_access on public.followup_steps for all
  using (
    clinic_id in (
      select c.id from public.clinics c
      join public.org_users ou on ou.organization_id = c.organization_id
      where ou.user_id = auth.uid()
    )
  );

-- Backfill 1:1: N passos por clínica (N = followup_max_attempts), todos com a copy/delay atuais.
insert into public.followup_steps (clinic_id, step_no, message_text, delay_minutes, enabled)
select ac.clinic_id,
       gs.step_no,
       coalesce(nullif(ac.followup_message, ''), 'Olá {paciente}, podemos continuar de onde paramos?'),
       coalesce(nullif(ac.followup_delay, 0), 1440),
       true
from public.ai_config ac
cross join lateral generate_series(1, greatest(coalesce(ac.followup_max_attempts, 1), 1)) as gs(step_no)
where exists (select 1 from public.clinics c where c.id = ac.clinic_id)
on conflict (clinic_id, step_no) do nothing;
