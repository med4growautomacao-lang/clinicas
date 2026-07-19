-- Rollback de 20260719000036_notification_prefs.sql
-- Restaura notify_ops sem os prefs (versão de 000024).
create or replace function public.notify_ops(
  p_clinic_id uuid, p_event text, p_title text, p_body text default null, p_level text default 'info',
  p_lead_id uuid default null, p_ticket_id uuid default null, p_appointment_id uuid default null,
  p_link text default null, p_payload jsonb default '{}'::jsonb, p_notify_group boolean default true, p_group_text text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_group text; v_token text; v_text text;
begin
  insert into notifications (clinic_id, event, level, title, body, lead_id, ticket_id, appointment_id, link, payload)
  values (p_clinic_id, p_event, coalesce(nullif(p_level,''),'info'), p_title, p_body, p_lead_id, p_ticket_id, p_appointment_id, p_link, coalesce(p_payload,'{}'::jsonb))
  returning id into v_id;
  if coalesce(p_notify_group, true) then
    begin
      select notification_group_id into v_group from clinics where id = p_clinic_id;
      if v_group is not null and btrim(v_group) <> '' then
        select api_token into v_token from whatsapp_instances where clinic_id = p_clinic_id limit 1;
        if v_token is not null and btrim(v_token) <> '' then
          v_text := coalesce(nullif(btrim(p_group_text), ''), p_title || case when p_body is not null and btrim(p_body) <> '' then E'\n' || p_body else '' end);
          perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
            jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
            jsonb_build_object('number', v_group, 'text', v_text, 'delay', 0), 5000);
        end if;
      end if;
    exception when others then
      perform log_system_error('notify_ops','group_send_failed','Falha ao espelhar notificação no grupo WhatsApp','warning', p_clinic_id, jsonb_build_object('event', p_event, 'detail', sqlerrm), false);
    end;
  end if;
  return v_id;
end; $$;
alter table public.notifications drop column if exists target_roles;
alter table public.clinics drop column if exists notification_prefs;
