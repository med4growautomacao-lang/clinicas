-- `ingest_wa_message` passa a compor a chave pela funcao compartilhada, em vez de repetir a
-- concatenacao. Com isso as duas pontas (RPC e trigger) nao podem mais divergir: e literalmente
-- o mesmo codigo. Sem isso, o "dono unico da chave" era so um comentario.

CREATE OR REPLACE FUNCTION public.ingest_wa_message(p_instance_token text, p_direction text, p_lead_phone text, p_content text, p_wa_message_id text DEFAULT NULL::text, p_lead_name text DEFAULT NULL::text, p_sender text DEFAULT 'human'::text, p_media_kind text DEFAULT NULL::text, p_media_mime text DEFAULT NULL::text, p_media_path text DEFAULT NULL::text, p_media_filename text DEFAULT NULL::text, p_media_duration numeric DEFAULT NULL::numeric, p_avatar_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_clinic uuid; v_clinic_phone text; v_norm text; v_lead RECORD; v_lead_created boolean := false;
  v_msg_id uuid; v_duplicate boolean := false; v_cfg RECORD; v_forward boolean := false;
  v_message jsonb; v_incoming text; v_incoming_real boolean; v_avatar text := nullif(btrim(p_avatar_url), '');
  v_session_id text;
begin
  if p_direction not in ('inbound','outbound') then
    return jsonb_build_object('success', false, 'error_code', 'invalid_direction');
  end if;

  select clinic_id, phone_number into v_clinic, v_clinic_phone
  from whatsapp_instances where api_token = p_instance_token limit 1;
  if v_clinic is null then
    return jsonb_build_object('success', false, 'error_code', 'instance_not_found');
  end if;

  v_norm := normalize_br_phone(p_lead_phone);
  if v_norm is null or length(v_norm) < 12 then
    return jsonb_build_object('success', false, 'error_code', 'invalid_phone');
  end if;

  v_incoming := nullif(btrim(p_lead_name), '');
  v_incoming_real := v_incoming is not null
    and lower(v_incoming) not in ('semnome','sem nome','contato')
    and v_incoming not like 'Lead %'
    and v_incoming !~ '^\+?[0-9][0-9\s\-]*$';

  select id, ai_enabled, is_not_lead, name into v_lead
  from leads where clinic_id = v_clinic and normalize_br_phone(phone) = v_norm
  order by last_activity_at desc nulls last limit 1;

  if v_lead.id is null and p_direction = 'inbound' then
    begin
      insert into leads (clinic_id, name, phone, source, capture_channel, avatar_url)
      values (v_clinic, case when v_incoming_real then v_incoming else 'Lead ' || v_norm end, v_norm, null, 'whatsapp', v_avatar)
      returning id, ai_enabled, is_not_lead, name into v_lead;
      v_lead_created := true;
    exception when unique_violation then
      select id, ai_enabled, is_not_lead, name into v_lead
      from leads where clinic_id = v_clinic and (phone = v_norm or normalize_br_phone(phone) = v_norm)
      order by last_activity_at desc nulls last limit 1;
    end;
  end if;

  if v_lead.id is not null and not v_lead_created then
    if v_incoming_real and (
         v_lead.name is null or btrim(v_lead.name) = ''
         or lower(v_lead.name) in ('semnome','sem nome','contato')
         or v_lead.name like 'Lead %') then
      update leads set name = v_incoming where id = v_lead.id;
    end if;
    if v_avatar is not null then
      update leads set avatar_url = v_avatar where id = v_lead.id and avatar_url is distinct from v_avatar;
    end if;
  end if;

  v_message := jsonb_build_object(
    'type', case when p_sender = 'ai' then 'ai' else 'human' end,
    'content', coalesce(p_content, ''),
    'additional_kwargs', '{}'::jsonb, 'response_metadata', '{}'::jsonb);
  if p_media_path is not null then
    v_message := v_message || jsonb_strip_nulls(jsonb_build_object(
      'kind', p_media_kind, 'mimetype', p_media_mime, 'fileURL', p_media_path,
      'filename', p_media_filename, 'duration', p_media_duration));
  end if;

  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, wa_message_id, message, metadata)
  values (v_clinic, v_lead.id, v_norm, p_direction, p_sender, nullif(btrim(p_wa_message_id), ''), v_message,
    case when p_media_path is not null
      then jsonb_strip_nulls(jsonb_build_object('kind',p_media_kind,'mime',p_media_mime,'storagePath',p_media_path,'filename',p_media_filename))
      else '{}'::jsonb end)
  returning id into v_msg_id;
  if v_msg_id is null then v_duplicate := true; end if;

  -- CHAVE DE MEMORIA: funcao compartilhada com o trigger fn_fill_chat_session_id. NAO concatenar
  -- aqui. Devolve NULL quando a instancia nao tem telefone, e nesse caso o ai-agent RECUSA o turno
  -- em vez de inventar uma chave (chave sem prefixo de clinica colide entre clinicas na unica de
  -- ai_turn_buffer).
  v_session_id := fn_chat_session_id(v_clinic, v_norm);

  select auto_schedule, response_wait_seconds, handoff_enabled, handoff_rules,
         confirm_enabled, transition_rules, test_mode_enabled, test_numbers
    into v_cfg from ai_config where clinic_id = v_clinic;

  v_forward := p_direction = 'inbound' and not v_duplicate
    and v_lead.id is not null and v_lead.ai_enabled is not false
    and coalesce(v_lead.is_not_lead, false) = false
    and coalesce(v_cfg.auto_schedule, false)
    and coalesce(current_setting('app.confirmation_handled', true), '') <> 'on'
    and (coalesce(v_cfg.test_mode_enabled, false) = false
         or exists (select 1 from unnest(coalesce(v_cfg.test_numbers, array[]::text[])) tn
                    where normalize_br_phone(tn) = v_norm));

  return jsonb_build_object(
    'success', true, 'clinic_id', v_clinic, 'clinic_phone', v_clinic_phone,
    'lead_id', v_lead.id, 'lead_created', v_lead_created, 'message_id', v_msg_id,
    'duplicate', v_duplicate, 'forward_ai', v_forward,
    'session_id', v_session_id, 'lead_phone_norm', v_norm,
    'ai', jsonb_build_object(
      'response_wait_seconds', coalesce(v_cfg.response_wait_seconds, 30),
      'handoff_enabled', coalesce(v_cfg.handoff_enabled, false),
      'handoff_rules', coalesce(v_cfg.handoff_rules, '[]'::jsonb),
      'confirm_enabled', coalesce(v_cfg.confirm_enabled, false),
      'transition_rules', coalesce(v_cfg.transition_rules, '[]'::jsonb)));
end;
$function$
;
