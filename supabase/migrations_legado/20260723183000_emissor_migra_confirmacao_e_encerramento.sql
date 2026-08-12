-- Migra 2 dos 5 emissores do BANCO para o Emissor, atras da chave `fn_emissor_ativo`.
-- Com a chave DESLIGADA (default e o estado de todas as clinicas exceto Vaz), o caminho antigo
-- roda byte por byte. So troca o BLOCO DE ENVIO; todos os gates de negocio ficam.
--
-- Por que estes dois primeiro: sao os que hoje pegam `api_token ... limit 1` cru (confirmacao) ou
-- fazem um pre-check proprio de WhatsApp (encerramento). No Emissor, o gate canonico
-- (fn_clinic_send_token) e a re-tentativa passam a valer de graca.

-- =============================================================================================
-- 1) CONFIRMACAO DE CONSULTA. Trigger em chat_messages: paciente responde "confirmar/remarcar/
--    cancelar" e recebe a resposta configurada. Hoje: `select api_token ... limit 1` (sem gate).
-- =============================================================================================
create or replace function public.fn_handle_confirmation_reply()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
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

  perform set_config('app.confirmation_handled', 'on', true);

  if v_action = 'confirmado' then
    v_new_status := 'confirmado'; v_reply := v_cfg.confirm_post_message;
    v_event := 'confirmacao'; v_title := 'Consulta confirmada'; v_level := 'success';
  elsif v_action = 'cancelado' then
    v_new_status := 'cancelado'; v_reply := v_cfg.confirm_reply_cancelado;
    v_event := null; v_title := null; v_level := null;
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
    v_number := normalize_br_phone(NEW.phone);

    if v_number is not null then
      if public.fn_emissor_ativo(NEW.clinic_id) then
        -- EMISSOR: enfileira. O gate de token, a entrega e o registro na conversa (so apos o 200)
        -- ficam no worker. chat_payload reproduz exatamente o registro de hoje (sender='system').
        perform public.emit_message(
          p_clinic_id => NEW.clinic_id, p_to_addr => v_number, p_producer => 'confirm_reply',
          p_body => v_reply, p_lead_id => NEW.lead_id,
          p_chat_payload => jsonb_build_object(
            'sender','system', 'phone', NEW.phone,
            'message', jsonb_build_object('type','system','content', v_reply,
                       'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb)));
      else
        -- Caminho antigo (chave desligada): envio inline, como sempre foi.
        select api_token into v_token from whatsapp_instances where clinic_id = NEW.clinic_id limit 1;
        if v_token is not null and btrim(v_token) <> '' then
          perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
            jsonb_build_object('Content-Type','application/json','token', v_token),
            jsonb_build_object('number', v_number, 'text', v_reply, 'delay', 0), 5000);
          insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
          values (NEW.clinic_id, NEW.lead_id, NEW.phone, 'outbound', 'system',
                  jsonb_build_object('type','system','content', v_reply, 'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb));
        end if;
      end if;
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
end; $function$;

-- =============================================================================================
-- 2) ENCERRAMENTO DE TICKET (ganho/perdido/service). Trigger em tickets. Hoje ja tem gate proprio;
--    no Emissor ele some (o worker cuida) e o encerramento passa a ter RE-TENTATIVA — hoje, se o
--    WhatsApp esta fora no instante do encerramento, a mensagem e perdida para sempre.
--    O marcador de dedup (finish_message_event) e o GUC keep_ticket_outcome CONTINUAM aqui, na
--    mesma transacao. dedup_key na fila = 'finish:<ticket>:<event>' (idempotencia dupla).
-- =============================================================================================
create or replace function public.fn_ticket_finish_message()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_event text; v_msg text; v_prefix text; v_cfg record;
  v_phone text; v_name text; v_token text;
  v_is_not_lead boolean; v_fu_enabled boolean;
  v_wa_status text; v_blocked timestamptz;
begin
  if NEW.outcome is distinct from OLD.outcome and NEW.outcome = 'ganho' then v_event := 'ganho';
  elsif NEW.outcome is distinct from OLD.outcome and NEW.outcome = 'perdido' then v_event := 'perdido';
  elsif NEW.status is distinct from OLD.status and NEW.status = 'closed'
        and NEW.outcome is not distinct from OLD.outcome then v_event := 'service';
  else return NEW; end if;

  if NEW.lead_id is null then return NEW; end if;
  if NEW.finish_message_event is not distinct from v_event then return NEW; end if;

  select finish_ganho_enabled, finish_ganho_message, finish_perdido_enabled, finish_perdido_message,
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

  select normalize_br_phone(phone), name, coalesce(is_not_lead,false), coalesce(followup_enabled,true)
    into v_phone, v_name, v_is_not_lead, v_fu_enabled
    from leads where id = NEW.lead_id;
  if v_phone is null then return NEW; end if;
  if v_is_not_lead then return NEW; end if;
  if not v_fu_enabled then return NEW; end if;

  v_msg := replace(replace(v_msg, '{paciente}', coalesce(v_name, '')), '{nome}', coalesce(v_name, ''));

  if public.fn_emissor_ativo(NEW.clinic_id) then
    -- EMISSOR: enfileira e marca o dedup. A entrega (com re-tentativa) fica no worker; sem o
    -- pre-check de WhatsApp, que agora e responsabilidade do gate do worker.
    perform public.emit_message(
      p_clinic_id => NEW.clinic_id, p_to_addr => v_phone, p_producer => 'ticket_finish',
      p_body => v_msg, p_lead_id => NEW.lead_id,
      p_dedup_key => 'finish:' || NEW.id::text || ':' || v_event,
      p_chat_payload => jsonb_build_object(
        'sender','system', 'phone', v_phone,
        'message', jsonb_build_object('type','system','content', v_msg,
                   'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb)));

    perform set_config('app.keep_ticket_outcome', 'on', true);
    update tickets set finish_message_event = v_event, finish_message_sent_at = now() where id = NEW.id;
    return NEW;
  end if;

  -- Caminho antigo (chave desligada): pre-check + envio inline, como sempre foi.
  select status, api_token, send_blocked_until
    into v_wa_status, v_token, v_blocked
    from whatsapp_instances where clinic_id = NEW.clinic_id
    order by (status = 'connected') desc nulls last limit 1;

  if v_token is null or btrim(v_token) = ''
     or v_wa_status is distinct from 'connected'
     or (v_blocked is not null and v_blocked > now()) then
    perform log_system_error('encerramento','finish_dropped_infra',
      'Mensagem de encerramento NÃO enviada: WhatsApp indisponível (disparo único, sem re-tentativa)',
      'info', NEW.clinic_id,
      jsonb_build_object('ticket_id', NEW.id, 'event', v_event,
        'wa_status', v_wa_status, 'blocked_until', v_blocked, 'has_token', v_token is not null),
      false);
    return NEW;
  end if;

  perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
    jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
    jsonb_build_object('number', v_phone, 'text', v_msg, 'delay', 0), 5000);

  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
  values (NEW.clinic_id, NEW.lead_id, v_phone, 'outbound', 'system',
          jsonb_build_object('type','system','content', v_msg,
                             'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

  perform set_config('app.keep_ticket_outcome', 'on', true);
  update tickets set finish_message_event = v_event, finish_message_sent_at = now() where id = NEW.id;
  return NEW;
exception when others then
  perform log_system_error('encerramento','finish_send_failed','Falha ao enviar mensagem de encerramento',
    'error', NEW.clinic_id, jsonb_build_object('ticket_id', NEW.id, 'event', v_event, 'detail', sqlerrm), false);
  return NEW;
end; $function$;