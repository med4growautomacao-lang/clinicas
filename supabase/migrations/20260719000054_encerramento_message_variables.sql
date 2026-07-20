-- Encerramento passa a substituir {paciente}/{nome} pelo nome do lead (antes enviava cru).
create or replace function public.fn_ticket_finish_message()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_event text; v_msg text; v_prefix text; v_cfg record; v_phone text; v_name text; v_token text;
begin
  if NEW.outcome is distinct from OLD.outcome and NEW.outcome = 'ganho' then
    v_event := 'ganho';
  elsif NEW.outcome is distinct from OLD.outcome and NEW.outcome = 'perdido' then
    v_event := 'perdido';
  elsif NEW.status is distinct from OLD.status and NEW.status = 'closed'
        and NEW.outcome is not distinct from OLD.outcome then
    v_event := 'service';
  else
    return NEW;
  end if;

  if NEW.lead_id is null then return NEW; end if;

  select finish_ganho_enabled, finish_ganho_message,
         finish_perdido_enabled, finish_perdido_message,
         finish_service_enabled, finish_service_message
    into v_cfg from ai_config where clinic_id = NEW.clinic_id;
  if v_cfg is null then return NEW; end if;

  if v_event = 'ganho' then
    if not coalesce(v_cfg.finish_ganho_enabled, false) then return NEW; end if;
    v_msg := v_cfg.finish_ganho_message; v_prefix := 'ENCERRAMENTO GANHO: ';
  elsif v_event = 'perdido' then
    if not coalesce(v_cfg.finish_perdido_enabled, false) then return NEW; end if;
    v_msg := v_cfg.finish_perdido_message; v_prefix := 'ENCERRAMENTO PERDIDO: ';
  else
    if not coalesce(v_cfg.finish_service_enabled, false) then return NEW; end if;
    v_msg := v_cfg.finish_service_message; v_prefix := 'ENCERRAMENTO: ';
  end if;

  if v_msg is null or btrim(v_msg) = '' then return NEW; end if;

  select normalize_br_phone(phone), name into v_phone, v_name from leads where id = NEW.lead_id;
  if v_phone is null then return NEW; end if;

  -- Personaliza: {paciente}/{nome} = nome do lead.
  v_msg := replace(replace(v_msg, '{paciente}', coalesce(v_name, '')), '{nome}', coalesce(v_name, ''));

  select api_token into v_token from whatsapp_instances where clinic_id = NEW.clinic_id limit 1;
  if v_token is null or btrim(v_token) = '' then return NEW; end if;

  perform system_http_post(
    'https://med4growautomacao.uazapi.com/send/text',
    jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
    jsonb_build_object('number', v_phone, 'text', v_msg, 'delay', 0),
    5000
  );

  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
  values (NEW.clinic_id, NEW.lead_id, v_phone, 'outbound', 'ai',
          jsonb_build_object('type','ai','content', v_prefix || v_msg,
                             'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

  return NEW;
exception when others then
  perform log_system_error('encerramento','finish_send_failed','Falha ao enviar mensagem de encerramento',
    'error', NEW.clinic_id, jsonb_build_object('ticket_id', NEW.id, 'event', v_event, 'detail', sqlerrm), false);
  return NEW;
end;
$$;
