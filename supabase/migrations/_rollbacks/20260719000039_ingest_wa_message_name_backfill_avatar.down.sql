-- Rollback: volta ao ingest_wa_message de 12 params (sem avatar nem backfill de nome).
drop function if exists public.ingest_wa_message(text,text,text,text,text,text,text,text,text,text,text,numeric,text);

create or replace function public.ingest_wa_message(
  p_instance_token text, p_direction text, p_lead_phone text, p_content text,
  p_wa_message_id text default null, p_lead_name text default null, p_sender text default 'human',
  p_media_kind text default null, p_media_mime text default null, p_media_path text default null,
  p_media_filename text default null, p_media_duration numeric default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_clinic uuid; v_clinic_phone text; v_norm text; v_lead RECORD; v_lead_created boolean := false;
  v_msg_id uuid; v_duplicate boolean := false; v_cfg RECORD; v_forward boolean := false; v_message jsonb;
begin
  if p_direction not in ('inbound','outbound') then
    return jsonb_build_object('success', false, 'error_code', 'invalid_direction');
  end if;
  select clinic_id, phone_number into v_clinic, v_clinic_phone
  from whatsapp_instances where api_token = p_instance_token limit 1;
  if v_clinic is null then return jsonb_build_object('success', false, 'error_code', 'instance_not_found'); end if;
  v_norm := normalize_br_phone(p_lead_phone);
  if v_norm is null or length(v_norm) < 12 then return jsonb_build_object('success', false, 'error_code', 'invalid_phone'); end if;
  select id, ai_enabled, is_not_lead into v_lead
  from leads where clinic_id = v_clinic and normalize_br_phone(phone) = v_norm
  order by last_activity_at desc nulls last limit 1;
  if v_lead.id is null and p_direction = 'inbound' then
    begin
      insert into leads (clinic_id, name, phone, source, capture_channel)
      values (v_clinic, coalesce(nullif(btrim(p_lead_name), ''), 'Lead ' || v_norm), v_norm, null, 'whatsapp')
      returning id, ai_enabled, is_not_lead into v_lead;
      v_lead_created := true;
    exception when unique_violation then
      select id, ai_enabled, is_not_lead into v_lead
      from leads where clinic_id = v_clinic and (phone = v_norm or normalize_br_phone(phone) = v_norm)
      order by last_activity_at desc nulls last limit 1;
    end;
  end if;
  v_message := jsonb_build_object('type', case when p_sender = 'ai' then 'ai' else 'human' end,
    'content', coalesce(p_content, ''), 'additional_kwargs', '{}'::jsonb, 'response_metadata', '{}'::jsonb);
  if p_media_path is not null then
    v_message := v_message || jsonb_strip_nulls(jsonb_build_object('kind', p_media_kind, 'mimetype', p_media_mime,
      'fileURL', p_media_path, 'filename', p_media_filename, 'duration', p_media_duration));
  end if;
  insert into chat_messages (clinic_id, lead_id, phone, direction, sender, wa_message_id, message, metadata)
  values (v_clinic, v_lead.id, v_norm, p_direction, p_sender, nullif(btrim(p_wa_message_id), ''), v_message,
    case when p_media_path is not null
      then jsonb_strip_nulls(jsonb_build_object('kind',p_media_kind,'mime',p_media_mime,'storagePath',p_media_path,'filename',p_media_filename))
      else '{}'::jsonb end)
  returning id into v_msg_id;
  if v_msg_id is null then v_duplicate := true; end if;
  select auto_schedule, response_wait_seconds, handoff_enabled, handoff_rules,
         confirm_enabled, transition_rules, test_mode_enabled, test_numbers
    into v_cfg from ai_config where clinic_id = v_clinic;
  v_forward := p_direction = 'inbound' and not v_duplicate and v_lead.id is not null and v_lead.ai_enabled is not false
    and coalesce(v_lead.is_not_lead, false) = false and coalesce(v_cfg.auto_schedule, false)
    and (coalesce(v_cfg.test_mode_enabled, false) = false
         or exists (select 1 from unnest(coalesce(v_cfg.test_numbers, array[]::text[])) tn where normalize_br_phone(tn) = v_norm));
  return jsonb_build_object('success', true, 'clinic_id', v_clinic, 'clinic_phone', v_clinic_phone,
    'lead_id', v_lead.id, 'lead_created', v_lead_created, 'message_id', v_msg_id,
    'duplicate', v_duplicate, 'forward_ai', v_forward,
    'ai', jsonb_build_object('response_wait_seconds', coalesce(v_cfg.response_wait_seconds, 30),
      'handoff_enabled', coalesce(v_cfg.handoff_enabled, false), 'handoff_rules', coalesce(v_cfg.handoff_rules, '[]'::jsonb),
      'confirm_enabled', coalesce(v_cfg.confirm_enabled, false), 'transition_rules', coalesce(v_cfg.transition_rules, '[]'::jsonb)));
end; $function$;

revoke all on function public.ingest_wa_message(text,text,text,text,text,text,text,text,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.ingest_wa_message(text,text,text,text,text,text,text,text,text,text,text,numeric) to service_role;
