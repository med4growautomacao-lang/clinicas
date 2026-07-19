-- Preferências de notificação por clínica + filtro por cargo.
-- notify_ops passa a respeitar clinics.notification_prefs:
--   { group_all, sino_all, events: { <evento>: { sino, grupo, roles:[cargos] } }, sla:{enabled,minutes} }
-- Default (prefs vazio) = tudo ligado, todos os cargos (retrocompat).
-- notifications.target_roles = cargos que veem no sino (null = todos); filtrado no front.

alter table public.clinics add column if not exists notification_prefs jsonb not null default '{}'::jsonb;
alter table public.notifications add column if not exists target_roles text[];

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
  v_prefs jsonb;
  v_ev jsonb;
  v_sino boolean;
  v_grupo boolean;
  v_roles text[];
begin
  select notification_prefs, notification_group_id into v_prefs, v_group
    from clinics where id = p_clinic_id;
  v_prefs := coalesce(v_prefs, '{}'::jsonb);
  v_ev := v_prefs -> 'events' -> p_event;

  -- gates (default TRUE se não configurado)
  v_sino  := coalesce((v_prefs->>'sino_all')::boolean, true)  and coalesce((v_ev->>'sino')::boolean, true);
  v_grupo := coalesce((v_prefs->>'group_all')::boolean, true) and coalesce((v_ev->>'grupo')::boolean, true);

  if v_ev ? 'roles' and jsonb_typeof(v_ev->'roles') = 'array' then
    v_roles := array(select jsonb_array_elements_text(v_ev->'roles'));
  else
    v_roles := null;  -- todos os cargos
  end if;

  -- (1) sino in-app
  if v_sino then
    insert into notifications (clinic_id, event, level, title, body, lead_id, ticket_id, appointment_id, link, payload, target_roles)
    values (p_clinic_id, p_event, coalesce(nullif(p_level,''),'info'), p_title, p_body,
            p_lead_id, p_ticket_id, p_appointment_id, p_link, coalesce(p_payload,'{}'::jsonb), v_roles)
    returning id into v_id;
  end if;

  -- (2) grupo WhatsApp (best-effort)
  if coalesce(p_notify_group, true) and v_grupo then
    begin
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
