-- Gate do Roteiro dentro de ingest_wa_message.
--
-- ⚠️ POR QUE AQUI E NÃO NUM SEGUNDO PONTO DE ENTRADA: `v_forward` carrega dois silenciadores que
-- só existem nesta função, `app.confirmation_handled` e a lista de números de teste do ai_config.
-- Um motor com lista PARALELA de ifs consumiria o clique de "Cancelar consulta" do lembrete de
-- agenda como se fosse resposta de passo, e a consulta não seria cancelada: é exatamente o bug dos
-- 7 cliques perdidos de julho voltando por outra porta. Aqui a base é UMA só (`v_base`), e dela
-- saem os dois caminhos.
--
-- ⚠️ ROTEIRO E AGENTE SÃO EXCLUSIVOS (decisão do dono, 13/08/2026): quando o roteiro atende,
-- `forward_ai` sai FALSE na mesma linha. Nunca os dois no mesmo turno.
--
-- Nada muda para quem não tem roteiro: sem linha ativa em chatbot_scripts, fn_chatbot_turno
-- devolve atendeu=false no primeiro `select` e `forward_ai` fica idêntico ao de hoje.

create or replace function public.ingest_wa_message(
  p_instance_token text, p_direction text, p_lead_phone text, p_content text,
  p_wa_message_id text default null, p_lead_name text default null, p_sender text default 'human',
  p_media_kind text default null, p_media_mime text default null, p_media_path text default null,
  p_media_filename text default null, p_media_duration numeric default null, p_avatar_url text default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $function$
declare
  v_clinic uuid; v_clinic_phone text; v_norm text; v_lead RECORD; v_lead_created boolean := false;
  v_msg_id uuid; v_duplicate boolean := false; v_cfg RECORD; v_forward boolean := false;
  v_message jsonb; v_incoming text; v_incoming_real boolean; v_avatar text := nullif(btrim(p_avatar_url), '');
  v_session_id text;
  v_base boolean := false; v_roteiro jsonb := null; v_roteiro_ok boolean := false;
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

  -- ⚠️ REDE DE SEGURANCA: o INSERT acima pode ter sido ENGOLIDO pela trigger
  -- `fn_handle_lead_uniqueness`, que faz RETURN NULL quando ela mesma encontra o lead. Nesse caso
  -- nao ha `unique_violation`, o handler acima nao roda, o `returning` nao atribui e `v_lead.id`
  -- fica nulo -- e com ele nulo o `v_forward` la embaixo vira false e O AGENTE NAO E ACIONADO,
  -- em silencio. So acontece em rajada de contato novo (o lead nasce entre a busca e o insert).
  -- Aqui a gente re-busca; se ainda assim nao achar, acende na Central em vez de calar.
  if v_lead.id is null and p_direction = 'inbound' then
    select id, ai_enabled, is_not_lead, name into v_lead
    from leads where clinic_id = v_clinic and normalize_br_phone(phone) = v_norm
    order by last_activity_at desc nulls last limit 1;
    v_lead_created := false;
    if v_lead.id is null then
      begin
        perform log_system_error(
          'wa-inbound', 'lead_nao_resolvido',
          'Mensagem recebida sem conseguir resolver o lead: o agente NAO foi acionado',
          'critical', v_clinic,
          jsonb_build_object('telefone', v_norm, 'wa_message_id', p_wa_message_id), false);
      exception when others then null;
      end;
    end if;
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

  -- VALVULA: escreveu, entao tem WhatsApp. Desfaz a marca antes de qualquer trigger responder.
  if p_direction = 'inbound' and v_lead.id is not null then
    update leads set whatsapp_invalid = false
     where id = v_lead.id and coalesce(whatsapp_invalid, false) is true;
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

  v_session_id := fn_chat_session_id(v_clinic, v_norm);

  select auto_schedule, response_wait_seconds, handoff_enabled, handoff_rules,
         confirm_enabled, transition_rules, test_mode_enabled, test_numbers
    into v_cfg from ai_config where clinic_id = v_clinic;

  -- ── BASE: os silenciadores que valem para QUALQUER um que fosse responder o contato ───────────
  v_base := p_direction = 'inbound' and not v_duplicate
    and v_lead.id is not null and v_lead.ai_enabled is not false
    and coalesce(v_lead.is_not_lead, false) = false
    and coalesce(current_setting('app.confirmation_handled', true), '') <> 'on';

  v_forward := v_base
    and coalesce(v_cfg.auto_schedule, false)
    and (coalesce(v_cfg.test_mode_enabled, false) = false
         or exists (select 1 from unnest(coalesce(v_cfg.test_numbers, array[]::text[])) tn
                    where normalize_br_phone(tn) = v_norm));

  -- ── ROTEIRO: mesma base, SEM a exigência de a IA estar ligada ─────────────────────────────────
  -- O botão clicado chega em p_content como rótulo OU como id (wa-inbound grava `rotulo || id`),
  -- e o casador trata as duas formas, além do número digitado. Por isso o roteiro funciona sem
  -- nenhuma mudança na edge.
  if v_base then
    v_roteiro := fn_chatbot_turno(v_clinic, v_lead.id, v_norm, p_content, null);
    v_roteiro_ok := coalesce((v_roteiro->>'atendeu')::boolean, false);
    if v_roteiro_ok then
      v_forward := false;   -- um OU outro, nunca os dois
      -- A fila é varrida a cada minuto pelo cron; sem este empurrão o contato esperaria até 60s
      -- pela resposta de um robô. Falha aqui não é problema: o cron continua sendo a rede.
      begin
        perform system_http_post(
          'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/emissor-worker',
          '{"Content-Type":"application/json"}'::jsonb,
          jsonb_build_object('mode','kick','clinic_id', v_clinic::text),
          5000);
      exception when others then null;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'success', true, 'clinic_id', v_clinic, 'clinic_phone', v_clinic_phone,
    'lead_id', v_lead.id, 'lead_created', v_lead_created, 'message_id', v_msg_id,
    'duplicate', v_duplicate, 'forward_ai', v_forward,
    'roteiro_ok', v_roteiro_ok, 'roteiro', v_roteiro,
    'session_id', v_session_id, 'lead_phone_norm', v_norm,
    'ai', jsonb_build_object(
      'response_wait_seconds', coalesce(v_cfg.response_wait_seconds, 30),
      'handoff_enabled', coalesce(v_cfg.handoff_enabled, false),
      'handoff_rules', coalesce(v_cfg.handoff_rules, '[]'::jsonb),
      'confirm_enabled', coalesce(v_cfg.confirm_enabled, false),
      'transition_rules', coalesce(v_cfg.transition_rules, '[]'::jsonb)));
end;
$function$;

revoke all on function public.ingest_wa_message(text,text,text,text,text,text,text,text,text,text,text,numeric,text)
  from public, anon, authenticated;
