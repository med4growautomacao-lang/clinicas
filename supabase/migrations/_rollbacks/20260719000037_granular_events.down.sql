-- Rollback de 20260719000037_granular_events.sql
drop trigger if exists trg_notify_venda on public.tickets;
drop function if exists public.fn_notify_venda();

-- Restaura o trigger de agendamento (evento único 'agendamento', com faltou).
create or replace function public.fn_notify_appointment_event()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_title text; v_level text; v_patient text; v_doctor text; v_lead uuid; v_when text;
begin
  if TG_OP = 'INSERT' then
    if NEW.source is distinct from 'ia' then return NEW; end if;
    v_title := 'Nova consulta agendada pela IA'; v_level := 'success';
  elsif TG_OP = 'UPDATE' then
    if NEW.status is not distinct from OLD.status then return NEW; end if;
    if NEW.status = 'cancelado' then v_title := 'Consulta cancelada'; v_level := 'warning';
    elsif NEW.status = 'faltou' then v_title := 'Paciente faltou'; v_level := 'warning';
    else return NEW; end if;
  else return NEW; end if;
  select name into v_patient from patients where id = NEW.patient_id;
  select name into v_doctor from doctors where id = NEW.doctor_id;
  if NEW.ticket_id is not null then select lead_id into v_lead from tickets where id = NEW.ticket_id; end if;
  v_when := to_char(NEW.date,'DD/MM') || case when NEW.time is not null then ' '||substr(NEW.time::text,1,5) else '' end;
  perform notify_ops(NEW.clinic_id,'agendamento',v_title,
    coalesce(nullif(btrim(v_patient),''),'Paciente') || case when v_doctor is not null and btrim(v_doctor)<>'' then ' com '||v_doctor else '' end || ' — '||v_when,
    v_level, v_lead, NEW.ticket_id, NEW.id, null, jsonb_build_object('status',NEW.status,'source',NEW.source), true, null);
  return NEW;
exception when others then
  perform log_system_error('appointment-notify','notify_failed','Falha ao notificar evento de agendamento','error', NEW.clinic_id, jsonb_build_object('appointment_id', NEW.id, 'op', TG_OP, 'detail', sqlerrm), false);
  return NEW;
end; $$;

-- Nota: fn_handle_confirmation_reply volta a usar evento 'agendamento' — reaplicar 000037 up para granular.
