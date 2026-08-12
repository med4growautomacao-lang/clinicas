-- Eventos de notificação granulares (chave de desligamento por tipo).
-- Chaves canônicas: handoff, agendamento_novo, confirmacao, remarcacao, cancelamento,
--                   comprovante, venda, nao_atendido.

-- 1) Agendamento: novo (source=ia) e cancelamento. FALTOU não notifica mais.
create or replace function public.fn_notify_appointment_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event text;
  v_title text;
  v_level text;
  v_patient text;
  v_doctor text;
  v_lead uuid;
  v_when text;
begin
  if TG_OP = 'INSERT' then
    if NEW.source is distinct from 'ia' then return NEW; end if;
    v_event := 'agendamento_novo'; v_title := 'Nova consulta agendada pela IA'; v_level := 'success';
  elsif TG_OP = 'UPDATE' then
    if NEW.status is not distinct from OLD.status then return NEW; end if;
    if NEW.status = 'cancelado' then
      v_event := 'cancelamento'; v_title := 'Consulta cancelada'; v_level := 'warning';
    else
      return NEW;  -- faltou/confirmado/etc não notificam por aqui
    end if;
  else
    return NEW;
  end if;

  select name into v_patient from patients where id = NEW.patient_id;
  select name into v_doctor  from doctors  where id = NEW.doctor_id;
  if NEW.ticket_id is not null then
    select lead_id into v_lead from tickets where id = NEW.ticket_id;
  end if;

  v_when := to_char(NEW.date, 'DD/MM') ||
            case when NEW.time is not null then ' ' || substr(NEW.time::text, 1, 5) else '' end;

  perform notify_ops(
    NEW.clinic_id, v_event, v_title,
    coalesce(nullif(btrim(v_patient), ''), 'Paciente')
      || case when v_doctor is not null and btrim(v_doctor) <> '' then ' com ' || v_doctor else '' end
      || ' — ' || v_when,
    v_level, v_lead, NEW.ticket_id, NEW.id, null,
    jsonb_build_object('status', NEW.status, 'source', NEW.source), true, null
  );
  return NEW;
exception when others then
  perform log_system_error('appointment-notify', 'notify_failed', 'Falha ao notificar evento de agendamento',
    'error', NEW.clinic_id, jsonb_build_object('appointment_id', NEW.id, 'op', TG_OP, 'detail', sqlerrm), false);
  return NEW;
end;
$$;

-- 2) Confirmação de consulta: confirmar -> 'confirmacao', remarcar -> 'remarcacao'.
create or replace function public.fn_handle_confirmation_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_content text; v_action text; v_cfg record; v_appt record;
  v_reply text; v_token text; v_number text;
  v_event text; v_title text; v_level text; v_new_status text;
begin
  if NEW.lead_id is null then return NEW; end if;
  v_content := lower(btrim(coalesce(NEW.message->>'content', '')));
  if v_content = '' then return NEW; end if;

  if v_content like '%confirmar consulta%' or v_content = 'confirmado' then
    v_action := 'confirmado';
  elsif v_content like '%remarcar consulta%' or v_content in ('remarcar','remarcado') then
    v_action := 'remarcado';
  elsif v_content like '%cancelar consulta%' or v_content = 'cancelado' then
    v_action := 'cancelado';
  else
    return NEW;
  end if;

  select confirm_native_enabled, confirm_post_message, confirm_reply_remarcado, confirm_reply_cancelado
    into v_cfg from ai_config where clinic_id = NEW.clinic_id;
  if v_cfg is null or v_cfg.confirm_native_enabled is not true then return NEW; end if;

  select a.id, a.date, a.time, p.name as patient_name
    into v_appt
    from appointments a
    join patients p on p.id = a.patient_id
    left join tickets t on t.id = a.ticket_id
   where a.clinic_id = NEW.clinic_id
     and a.reminder_sent_at is not null
     and a.status in ('pendente','confirmado')
     and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
     and (t.lead_id = NEW.lead_id or normalize_br_phone(p.phone) = normalize_br_phone(NEW.phone))
   order by a.reminder_sent_at desc
   limit 1;
  if v_appt.id is null then return NEW; end if;

  if v_action = 'confirmado' then
    v_new_status := 'confirmado'; v_reply := v_cfg.confirm_post_message;
    v_event := 'confirmacao'; v_title := 'Consulta confirmada'; v_level := 'success';
  elsif v_action = 'cancelado' then
    v_new_status := 'cancelado'; v_reply := v_cfg.confirm_reply_cancelado;
    v_event := null; v_title := null; v_level := null;   -- cancelamento é notificado pelo trigger de agendamento
  else
    v_new_status := null; v_reply := v_cfg.confirm_reply_remarcado;
    v_event := 'remarcacao'; v_title := 'Remarcação solicitada'; v_level := 'warning';
  end if;

  if v_new_status is not null then
    update appointments set status = v_new_status where id = v_appt.id;
  end if;

  if v_reply is not null and btrim(v_reply) <> '' then
    v_reply := replace(replace(replace(v_reply,
      '{paciente}', coalesce(v_appt.patient_name, '')),
      '{data}', to_char(v_appt.date, 'DD/MM/YYYY')),
      '{hora}', substr(v_appt.time::text, 1, 5));
    select api_token into v_token from whatsapp_instances where clinic_id = NEW.clinic_id limit 1;
    v_number := normalize_br_phone(NEW.phone);
    if v_token is not null and btrim(v_token) <> '' and v_number is not null then
      perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','token', v_token),
        jsonb_build_object('number', v_number, 'text', v_reply, 'delay', 0), 5000);
      insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
      values (NEW.clinic_id, NEW.lead_id, NEW.phone, 'outbound', 'ai',
              jsonb_build_object('type','ai','content', v_reply, 'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb));
    end if;
  end if;

  if v_event is not null then
    perform notify_ops(NEW.clinic_id, v_event, v_title,
      coalesce(v_appt.patient_name, 'Paciente') || ' — ' || to_char(v_appt.date,'DD/MM') || ' ' || substr(v_appt.time::text,1,5),
      v_level, NEW.lead_id, null, v_appt.id, null, jsonb_build_object('action', v_action), true, null);
  end if;
  return NEW;
exception when others then
  perform log_system_error('confirm-reply','confirm_reply_failed','Falha ao processar resposta de confirmação','error', NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false);
  return NEW;
end;
$$;

-- 3) Venda realizada: ticket vira 'ganho'.
create or replace function public.fn_notify_venda()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_lead record;
begin
  if NEW.outcome is distinct from 'ganho' then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.outcome is not distinct from 'ganho' then return NEW; end if;  -- já era ganho
  if NEW.lead_id is null then return NEW; end if;

  select name, phone into v_lead from leads where id = NEW.lead_id;
  perform notify_ops(
    NEW.clinic_id, 'venda', 'Venda realizada! 🎉',
    coalesce(nullif(btrim(v_lead.name), ''), v_lead.phone) || coalesce(' · ' || nullif(v_lead.phone, ''), ''),
    'success', NEW.lead_id, NEW.id, null, null, '{}'::jsonb, true, null
  );
  return NEW;
exception when others then
  perform log_system_error('venda-notify','notify_failed','Falha ao notificar venda','error', NEW.clinic_id, jsonb_build_object('ticket_id', NEW.id, 'detail', sqlerrm), false);
  return NEW;
end;
$$;

drop trigger if exists trg_notify_venda on public.tickets;
create trigger trg_notify_venda
  after insert or update of outcome on public.tickets
  for each row execute function public.fn_notify_venda();
