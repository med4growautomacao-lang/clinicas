-- Fase C dos relatórios: envio pelo WhatsApp da ORGANIZAÇÃO.
-- report_settings = config por clínica (destinatários + agenda).
-- report_sends    = log/auditoria de envios (também dedup do cron).
-- send_clinic_report = gera via build_commercial_report e envia via a
-- instância da ORG (system_http_post → uazapi), 1 msg por destinatário.
-- (Aplicada em produção via MCP como 'report_settings_and_send'.)

create table public.report_settings (
  clinic_id uuid primary key references public.clinics(id) on delete cascade,
  recipients text[] not null default '{}',
  schedule_enabled boolean not null default false,
  cadence text not null default 'weekly' check (cadence in ('daily','weekly')),
  send_weekday int not null default 1 check (send_weekday between 0 and 6),
  send_hour int not null default 8 check (send_hour between 0 and 23),
  kind text not null default 'completo' check (kind in ('completo','geral','ia','humano')),
  period_days int not null default 7 check (period_days between 1 and 90),
  updated_at timestamptz not null default now()
);

alter table public.report_settings enable row level security;

create policy report_settings_org_admin on public.report_settings
  for all
  using (
    is_clinic_admin(clinic_id)
    or clinic_id in (
      select c.id from public.clinics c
      join public.org_users ou on ou.organization_id = c.organization_id
      where ou.user_id = auth.uid() and ou.role in ('org_admin','org_owner'))
  )
  with check (
    is_clinic_admin(clinic_id)
    or clinic_id in (
      select c.id from public.clinics c
      join public.org_users ou on ou.organization_id = c.organization_id
      where ou.user_id = auth.uid() and ou.role in ('org_admin','org_owner'))
  );

create table public.report_sends (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete set null,
  kind text not null,
  trigger text not null check (trigger in ('manual','scheduled')),
  recipients text[] not null,
  period jsonb,
  sent_at timestamptz not null default now()
);
create index idx_report_sends_clinic_day on public.report_sends (clinic_id, sent_at);

alter table public.report_sends enable row level security;
create policy report_sends_read on public.report_sends
  for select
  using (
    is_clinic_admin(clinic_id)
    or clinic_id in (
      select c.id from public.clinics c
      join public.org_users ou on ou.organization_id = c.organization_id
      where ou.user_id = auth.uid())
  );

create or replace function public.send_clinic_report(
  p_clinic_id uuid,
  p_kind text default 'completo',
  p_entry_from date default null, p_entry_to date default null,
  p_conv_from date default null,  p_conv_to date default null,
  p_appt_from date default null,  p_appt_to date default null,
  p_trigger text default 'manual'
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_org_id uuid;
  v_token text;
  v_status text;
  v_recipients text[];
  v_text text;
  v_num text;
  v_norm text;
  v_sent int := 0;
begin
  -- Guard: service role/cron (sem JWT) passa; usuário logado precisa de permissão
  if auth.uid() is not null then
    if not (
      is_super_admin()
      or is_clinic_admin(p_clinic_id)
      or exists (select 1 from clinics c join org_users ou on ou.organization_id = c.organization_id
                 where c.id = p_clinic_id and ou.user_id = auth.uid() and ou.role in ('org_admin','org_owner'))
    ) then
      raise exception 'sem permissão para enviar relatório desta clínica';
    end if;
  end if;

  select organization_id into v_org_id from clinics where id = p_clinic_id;
  if v_org_id is null then
    return jsonb_build_object('success', false, 'error', 'clinica_sem_organizacao');
  end if;

  select api_token, status into v_token, v_status
  from whatsapp_instances where org_id = v_org_id;
  if v_token is null or btrim(v_token) = '' or v_status is distinct from 'connected' then
    return jsonb_build_object('success', false, 'error', 'org_whatsapp_desconectado');
  end if;

  select recipients into v_recipients from report_settings where clinic_id = p_clinic_id;
  if v_recipients is null or cardinality(v_recipients) = 0 then
    return jsonb_build_object('success', false, 'error', 'sem_destinatarios');
  end if;

  v_text := build_commercial_report(p_clinic_id, p_kind, p_entry_from, p_entry_to,
                                    p_conv_from, p_conv_to, p_appt_from, p_appt_to, true);

  foreach v_num in array v_recipients loop
    v_norm := normalize_br_phone(v_num);
    continue when v_norm is null or length(v_norm) < 12;
    begin
      perform system_http_post(
        'https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
        jsonb_build_object('number', v_norm, 'text', v_text, 'delay', 0),
        8000
      );
      v_sent := v_sent + 1;
    exception when others then
      perform log_system_error('report_send','send_failed',
        'Falha ao enviar relatório pelo WhatsApp da organização', 'error',
        p_clinic_id, jsonb_build_object('recipient', v_norm, 'detail', sqlerrm), false);
    end;
  end loop;

  if v_sent = 0 then
    perform log_system_error('report_send','no_valid_recipient',
      'Relatório não enviado: nenhum destinatário válido (telefone < 12 dígitos?)', 'warning',
      p_clinic_id, jsonb_build_object('recipients', v_recipients), false);
    return jsonb_build_object('success', false, 'error', 'nenhum_destinatario_valido');
  end if;

  insert into report_sends (clinic_id, org_id, kind, trigger, recipients, period)
  values (p_clinic_id, v_org_id, p_kind, coalesce(p_trigger,'manual'), v_recipients,
          jsonb_build_object('entry_from', p_entry_from, 'entry_to', p_entry_to,
                             'conv_from', p_conv_from, 'conv_to', p_conv_to,
                             'appt_from', p_appt_from, 'appt_to', p_appt_to));

  return jsonb_build_object('success', true, 'sent', v_sent);
end;
$function$;

revoke execute on function public.send_clinic_report(uuid, text, date, date, date, date, date, date, text) from anon;
