-- 20260718205818_notifications_center
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Centro de notificações nativo (in-app) + notificador unificado notify_ops.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  event text not null,
  level text not null default 'info',
  title text not null,
  body text,
  lead_id uuid references public.leads(id) on delete set null,
  ticket_id uuid,
  appointment_id uuid,
  link text,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  read_by uuid,
  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Feed de notificações operacionais por clínica (sino da Sidebar). Alimentado por notify_ops, que também espelha no grupo do WhatsApp. Read state COMPARTILHADO pela equipe (v1).';

create index if not exists idx_notifications_clinic_created on public.notifications (clinic_id, created_at desc);
create index if not exists idx_notifications_clinic_unread  on public.notifications (clinic_id) where read_at is null;
create index if not exists idx_notifications_lead           on public.notifications (lead_id) where lead_id is not null;

alter table public.notifications enable row level security;

create policy notifications_sel_clinic on public.notifications
  for select using (
    ((clinic_id in (select cu.clinic_id from clinic_users cu where cu.id = auth.uid())) and is_clinic_active(clinic_id))
    or is_clinic_admin(clinic_id)
  );

create policy notifications_sel_org on public.notifications
  for select using (
    ((clinic_id in (
        select c.id from clinics c
        join org_users ou on ou.organization_id = c.organization_id
        where ou.user_id = auth.uid()
      )) and is_clinic_active(clinic_id))
    or is_clinic_admin(clinic_id)
  );

create or replace function public.notify_ops(
  p_clinic_id uuid,
  p_event text,
  p_title text,
  p_body text default null,
  p_level text default 'info',
  p_lead_id uuid default null,
  p_ticket_id uuid default null,
  p_appointment_id uuid default null,
  p_link text default null,
  p_payload jsonb default '{}'::jsonb,
  p_notify_group boolean default true,
  p_group_text text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_group text;
  v_token text;
  v_text text;
begin
  insert into notifications (clinic_id, event, level, title, body, lead_id, ticket_id, appointment_id, link, payload)
  values (p_clinic_id, p_event, coalesce(nullif(p_level,''),'info'), p_title, p_body,
          p_lead_id, p_ticket_id, p_appointment_id, p_link, coalesce(p_payload,'{}'::jsonb))
  returning id into v_id;

  if coalesce(p_notify_group, true) then
    begin
      select notification_group_id into v_group from clinics where id = p_clinic_id;
      if v_group is not null and btrim(v_group) <> '' then
        select api_token into v_token from whatsapp_instances where clinic_id = p_clinic_id limit 1;
        if v_token is not null and btrim(v_token) <> '' then
          v_text := coalesce(
            nullif(btrim(p_group_text), ''),
            p_title || case when p_body is not null and btrim(p_body) <> '' then E'\n' || p_body else '' end
          );
          perform system_http_post(
            'https://med4growautomacao.uazapi.com/send/text',
            jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
            jsonb_build_object('number', v_group, 'text', v_text, 'delay', 0),
            5000
          );
        end if;
      end if;
    exception when others then
      perform log_system_error(
        'notify_ops','group_send_failed','Falha ao espelhar notificação no grupo WhatsApp',
        'warning', p_clinic_id, jsonb_build_object('event', p_event, 'detail', sqlerrm), false
      );
    end;
  end if;

  return v_id;
end;
$$;

comment on function public.notify_ops is
  'Notificador unificado: grava em notifications (sino in-app) e espelha no grupo WhatsApp (clinics.notification_group_id) via system_http_post. Chamado por handoff (IA+manual), agendamentos, comprovante, SLA.';

create or replace function public.mark_notifications_read(
  p_clinic_id uuid,
  p_ids uuid[] default null
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean;
  v_count integer;
begin
  if v_uid is null then return 0; end if;

  select (
    exists (select 1 from clinic_users cu where cu.id = v_uid and cu.clinic_id = p_clinic_id)
    or exists (
      select 1 from clinics c
      join org_users ou on ou.organization_id = c.organization_id
      where c.id = p_clinic_id and ou.user_id = v_uid
    )
    or is_clinic_admin(p_clinic_id)
  ) into v_ok;
  if not v_ok then return 0; end if;

  update notifications
     set read_at = now(), read_by = v_uid
   where clinic_id = p_clinic_id
     and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.notify_ops(uuid,text,text,text,text,uuid,uuid,uuid,text,jsonb,boolean,text) from public;
grant execute on function public.notify_ops(uuid,text,text,text,text,uuid,uuid,uuid,text,jsonb,boolean,text) to service_role;
revoke all on function public.mark_notifications_read(uuid,uuid[]) from public;
grant execute on function public.mark_notifications_read(uuid,uuid[]) to authenticated, service_role;

do $$
begin
  begin
    alter publication supabase_realtime add table public.notifications;
  exception when duplicate_object then null;
  end;
end $$;
