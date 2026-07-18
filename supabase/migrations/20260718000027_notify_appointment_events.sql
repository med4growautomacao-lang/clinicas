-- Notificações de agendamento no notify_ops (sino in-app + grupo WhatsApp).
--
-- Trigger agnóstico de transporte em appointments (cobre app, Kanban e IA). Alta-relevância,
-- baixo ruído:
--   INSERT source='ia'  -> "Nova consulta agendada pela IA" (a IA marcou sozinha; a equipe quer ver).
--                          Agendamento manual (balcão/app) a equipe JÁ sabe -> não notifica.
--   UPDATE status->cancelado -> "Consulta cancelada"
--   UPDATE status->faltou    -> "Paciente faltou"
-- book_appointment é idempotente (repeat não faz novo INSERT) -> sem notificação duplicada.

create or replace function public.fn_notify_appointment_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_title text;
  v_level text;
  v_patient text;
  v_doctor text;
  v_lead uuid;
  v_when text;
begin
  if TG_OP = 'INSERT' then
    if NEW.source is distinct from 'ia' then
      return NEW;  -- só agendamento autônomo da IA
    end if;
    v_title := 'Nova consulta agendada pela IA';
    v_level := 'success';
  elsif TG_OP = 'UPDATE' then
    if NEW.status is not distinct from OLD.status then
      return NEW;
    end if;
    if NEW.status = 'cancelado' then
      v_title := 'Consulta cancelada'; v_level := 'warning';
    elsif NEW.status = 'faltou' then
      v_title := 'Paciente faltou'; v_level := 'warning';
    else
      return NEW;  -- outras transições (confirmado/compareceu/realizado) não notificam
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
    NEW.clinic_id, 'agendamento', v_title,
    coalesce(nullif(btrim(v_patient), ''), 'Paciente')
      || case when v_doctor is not null and btrim(v_doctor) <> '' then ' com ' || v_doctor else '' end
      || ' — ' || v_when,
    v_level, v_lead, NEW.ticket_id, NEW.id, null,
    jsonb_build_object('status', NEW.status, 'source', NEW.source), true, null
  );
  return NEW;
exception when others then
  perform log_system_error(
    'appointment-notify', 'notify_failed', 'Falha ao notificar evento de agendamento',
    'error', NEW.clinic_id, jsonb_build_object('appointment_id', NEW.id, 'op', TG_OP, 'detail', sqlerrm), false
  );
  return NEW;
end;
$$;

-- zz_ para rodar DEPOIS dos triggers que movem o funil (auto_move_lead_*).
drop trigger if exists trg_zz_notify_appointment_event on public.appointments;
create trigger trg_zz_notify_appointment_event
  after insert or update of status on public.appointments
  for each row
  execute function public.fn_notify_appointment_event();
