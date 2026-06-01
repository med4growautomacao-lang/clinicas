-- WhatsApp connection state machine + audit log
--
-- Why: 4 atores (frontend, ConnectPage, edge bridge, n8n) escreviam direto na tabela
-- sem ordem nem validação. QR regenerava a cada 15s (pulse) e status ficava preso
-- em estados intermediários. Esta migration estabelece a tabela como autoritativa
-- de estado: transições validadas em trigger, rastro de tentativas via attempt_id,
-- expiração de QR alinhada à uazapi (2 min), e auditoria em whatsapp_events.

begin;

-- 1) Normaliza api_id vazio para NULL antes de criar UNIQUE parcial
update public.whatsapp_instances set api_id = null where api_id = '';

-- 2) Converte status legado qr_pending -> connecting (uazapi só tem 3 estados)
update public.whatsapp_instances set status = 'connecting' where status = 'qr_pending';

-- 3) Adiciona colunas de máquina de estados
alter table public.whatsapp_instances
  add column if not exists qr_expires_at      timestamptz,
  add column if not exists attempt_id          uuid,
  add column if not exists attempt_started_at  timestamptz,
  add column if not exists last_event_at       timestamptz not null default now(),
  add column if not exists last_error          text;

-- 4) Reduz CHECK de status para 3 valores oficiais da uazapi
alter table public.whatsapp_instances
  drop constraint if exists whatsapp_instances_status_check;
alter table public.whatsapp_instances
  add constraint whatsapp_instances_status_check
  check (status in ('disconnected', 'connecting', 'connected'));

-- 5) UNIQUE em connect_token e api_id (parcial — permite NULL múltiplo)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_instances_connect_token_key') then
    alter table public.whatsapp_instances add constraint whatsapp_instances_connect_token_key unique (connect_token);
  end if;
end $$;

create unique index if not exists ux_whatsapp_instances_api_id
  on public.whatsapp_instances (api_id)
  where api_id is not null;

-- 6) State machine: valida transições. Roda BEFORE UPDATE, antes dos demais
--    (prefixo 'aa_' garante ordem alfabética primeira)
create or replace function public.enforce_whatsapp_state_machine()
returns trigger
language plpgsql
as $$
declare
  v_allowed boolean;
begin
  -- Só valida se o status mudou
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_allowed := case
    when old.status = 'disconnected' and new.status = 'connecting'   then true
    when old.status = 'connecting'   and new.status = 'connected'    then true
    when old.status = 'connecting'   and new.status = 'disconnected' then true
    when old.status = 'connected'    and new.status = 'disconnected' then true
    else false
  end;

  if not v_allowed then
    raise exception 'whatsapp_state_machine: transição inválida % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  -- Side effects determinísticos por transição
  if new.status = 'connecting' then
    if new.attempt_id is null then
      new.attempt_id := gen_random_uuid();
    end if;
    if new.attempt_started_at is null then
      new.attempt_started_at := now();
    end if;
  elsif new.status = 'connected' then
    new.qr_code := null;
    new.qr_expires_at := null;
    new.attempt_id := null;
    new.attempt_started_at := null;
    new.last_error := null;
    if new.connected_at is null then
      new.connected_at := now();
    end if;
  elsif new.status = 'disconnected' then
    new.qr_code := null;
    new.qr_expires_at := null;
    new.attempt_id := null;
    new.attempt_started_at := null;
    new.connected_at := null;
    new.phone_number := null;
  end if;

  new.last_event_at := now();
  return new;
end;
$$;

drop trigger if exists tr_aa_whatsapp_state_machine on public.whatsapp_instances;
create trigger tr_aa_whatsapp_state_machine
  before update on public.whatsapp_instances
  for each row execute function public.enforce_whatsapp_state_machine();

-- 7) Tabela de auditoria
create table if not exists public.whatsapp_events (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics(id) on delete cascade,
  instance_id uuid references public.whatsapp_instances(id) on delete set null,
  attempt_id  uuid,
  event_type  text not null,
  payload     jsonb,
  source      text,
  created_at  timestamptz not null default now()
);

create index if not exists ix_whatsapp_events_clinic_created
  on public.whatsapp_events (clinic_id, created_at desc);
create index if not exists ix_whatsapp_events_attempt
  on public.whatsapp_events (attempt_id) where attempt_id is not null;

alter table public.whatsapp_events enable row level security;

drop policy if exists whatsapp_events_select on public.whatsapp_events;
create policy whatsapp_events_select on public.whatsapp_events
  for select using (
    (clinic_id in (select clinic_users.clinic_id from public.clinic_users where clinic_users.id = auth.uid())
     and public.is_clinic_active(clinic_id))
    or public.is_admin()
  );

-- INSERT vai vir só de edge functions com service_role, então não precisa policy

commit;
