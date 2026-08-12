-- 20260729211928_20260724437000_finish_message_respects_optout
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Mensagem de encerramento (ganho/perdido/serviço) respeita o opt-out por tipo.
-- Única alteração: o IF do opt-out logo após o gate mestre do lead. kind = 'finish_' || v_event,
-- e v_event só pode ser 'ganho'|'perdido'|'service' (valores aceitos pelo CHECK da tabela).
CREATE OR REPLACE FUNCTION public.fn_ticket_finish_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- opt-out por tipo (lead_followup_optout): finish_ganho / finish_perdido / finish_service
  if exists (select 1 from lead_followup_optout o
              where o.lead_id = NEW.lead_id and o.kind = 'finish_' || v_event) then
    return NEW;
  end if;

  v_msg := replace(replace(v_msg, '{paciente}', coalesce(v_name, '')), '{nome}', coalesce(v_name, ''));

  if public.fn_emissor_ativo(NEW.clinic_id, NEW.lead_id) then
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
