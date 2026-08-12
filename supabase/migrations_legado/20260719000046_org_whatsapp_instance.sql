-- WhatsApp da ORGANIZAÇÃO (remetente dos relatórios automáticos).
-- A instância da org vive na MESMA tabela whatsapp_instances (reusa orchestrator,
-- uazapi-events e state machine), mas é keyed por org_id em vez de clinic_id.
-- É send-only: não recebe mensagens (sem IA, sem chat) — só webhook 'connection'.
-- (Aplicada em produção via MCP apply_migration como 'org_whatsapp_instance'.)

-- 1) whatsapp_instances: passa a aceitar org OU clínica (exatamente um)
alter table public.whatsapp_instances alter column clinic_id drop not null;
alter table public.whatsapp_instances
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.whatsapp_instances
  add constraint whatsapp_instances_owner_check
  check ((clinic_id is null) <> (org_id is null));
create unique index if not exists uq_whatsapp_instances_org on public.whatsapp_instances(org_id)
  where org_id is not null;

-- 2) whatsapp_events idem (auditoria da conexão da org)
alter table public.whatsapp_events alter column clinic_id drop not null;
alter table public.whatsapp_events
  add column if not exists org_id uuid references public.organizations(id) on delete cascade;

-- 3) RLS: org_admin/org_owner gerenciam a instância da PRÓPRIA org
create policy whatsapp_instances_org_own on public.whatsapp_instances
  for all
  using (org_id is not null and org_id in (
    select ou.organization_id from public.org_users ou
    where ou.user_id = auth.uid() and ou.role in ('org_admin','org_owner')))
  with check (org_id is not null and org_id in (
    select ou.organization_id from public.org_users ou
    where ou.user_id = auth.uid() and ou.role in ('org_admin','org_owner')));

create policy whatsapp_events_org_own on public.whatsapp_events
  for select
  using (org_id is not null and org_id in (
    select ou.organization_id from public.org_users ou
    where ou.user_id = auth.uid() and ou.role in ('org_admin','org_owner')));
