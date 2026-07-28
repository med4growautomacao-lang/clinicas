-- emit_message re-normalizava o destino com normalize_br_phone, que REMOVE o 9o digito.
-- Isso desfazia o trabalho de quem ja tinha resolvido o JID real: o forms-welcome-followup
-- consulta a uazapi (/chat/check, testa com e sem 9), descobre "5521987141613" e passa esse
-- numero em p_to_addr; a RPC gravava "552187141613" e o worker levava 500 "not on WhatsApp".
--
-- Nao era so uma mensagem perdida. Sem envio nao ha chat_messages, e o reengajamento
-- (fn_followup_candidates_reengagement) so olha lead COM conversa (join lateral na ultima
-- mensagem). Com welcome_sent=true e zero mensagem, o lead ficava invisivel para os dois
-- motores: sem boas-vindas e sem follow-up, para sempre. 6 leads reais da Clinica Vaz entre
-- 24 e 27/07, 0 entregues.
--
-- Correcao: to_addr passa a guardar o DESTINO como o chamador resolveu; a normalizacao fica
-- so na conversation_key, que e chave de agrupamento/ordem, nao endereco de entrega. Quem ja
-- mandava numero de 12 digitos (ai_agent, reengagement, confirmacao) nao muda em nada.
--
-- NOTA: a migration 20260728012344 substitui o btrim puro por normalize_wa_addr (limpeza
-- defensiva de mascara/DDI que preserva o 9). Esta e a versao intermediaria.
create or replace function public.emit_message(
  p_clinic_id uuid,
  p_to_addr text,
  p_producer text,
  p_body text default null::text,
  p_kind text default 'text'::text,
  p_lead_id uuid default null::uuid,
  p_to_kind text default 'lead'::text,
  p_media_url text default null::text,
  p_media_base64 text default null::text,
  p_media_mime text default null::text,
  p_media_kind text default null::text,
  p_delay_ms integer default 0,
  p_dedup_key text default null::text,
  p_transport text default null::text,
  p_not_before timestamp with time zone default null::timestamp with time zone,
  p_chat_payload jsonb default null::jsonb,
  p_media_filename text default null::text,
  p_send_as text default 'clinic'::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_addr text; v_key text; v_transport text; v_simulado boolean := false; v_id uuid;
begin
  if p_clinic_id is null or coalesce(btrim(p_to_addr), '') = '' then
    raise exception 'emit_message: clinic_id e to_addr sao obrigatorios';
  end if;

  -- DESTINO: exatamente o que o chamador mandou. Se ele resolveu o numero no WhatsApp
  -- (com 9), e esse que tem que sair. Nao normalizar aqui e o ponto desta funcao.
  v_addr := btrim(p_to_addr);

  -- CHAVE DE CONVERSA: normalizada, para que o mesmo contato caia sempre na mesma fila
  -- ordenada, tenha o produtor mandado 12 ou 13 digitos.
  v_key := case when p_to_kind = 'lead' then coalesce(normalize_br_phone(v_addr), v_addr)
                else v_addr end;

  if p_lead_id is not null then
    select coalesce(is_simulation, false) into v_simulado from public.leads where id = p_lead_id;
  end if;
  v_transport := coalesce(p_transport, case when v_simulado then 'sandbox' else 'uazapi' end);

  insert into public.outbound_messages (
    clinic_id, lead_id, to_addr, to_kind, kind, body,
    media_url, media_base64, media_mime, media_kind, media_filename,
    delay_ms, transport, producer, conversation_key, dedup_key, not_before, chat_payload, send_as
  ) values (
    p_clinic_id, p_lead_id, v_addr, p_to_kind, p_kind, p_body,
    p_media_url, p_media_base64, p_media_mime, p_media_kind, p_media_filename,
    coalesce(p_delay_ms, 0), v_transport, p_producer,
    p_clinic_id::text || '|' || v_key, p_dedup_key, coalesce(p_not_before, now()), p_chat_payload,
    coalesce(p_send_as, 'clinic')
  )
  on conflict (dedup_key) where dedup_key is not null do nothing
  returning id into v_id;

  if v_id is null and p_dedup_key is not null then
    select id into v_id from public.outbound_messages where dedup_key = p_dedup_key;
  end if;
  return v_id;
end $function$;

-- outbound_register_chat usava to_addr cru como chat_messages.phone. Como to_addr agora pode
-- vir com o 9, normaliza aqui para a conversa seguir no formato canonico da casa (12 digitos),
-- que e o que o wa-inbound grava quando a pessoa responde. Sem isto, a mesma pessoa apareceria
-- com dois telefones no historico.
create or replace function public.outbound_register_chat(p_id uuid, p_provider_message_id text default null::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r public.outbound_messages;
  v_chat_id uuid;
begin
  select * into r from public.outbound_messages where id = p_id;
  if not found or r.chat_payload is null then return null; end if;
  if r.chat_message_id is not null then return r.chat_message_id; end if;  -- idempotente

  insert into public.chat_messages (
    clinic_id, lead_id, patient_id, phone, direction, sender, message,
    user_id, ticket_id, metadata, wa_message_id
  ) values (
    r.clinic_id,
    coalesce((r.chat_payload->>'lead_id')::uuid, r.lead_id),
    nullif(r.chat_payload->>'patient_id','')::uuid,
    coalesce(nullif(r.chat_payload->>'phone',''), normalize_br_phone(r.to_addr), r.to_addr),
    'outbound',
    coalesce(nullif(r.chat_payload->>'sender',''), 'system'),
    coalesce(r.chat_payload->'message',
             jsonb_build_object('type', coalesce(r.chat_payload->>'type','system'),
                                'content', coalesce(r.body, ''))),
    nullif(r.chat_payload->>'user_id','')::uuid,
    nullif(r.chat_payload->>'ticket_id','')::uuid,
    r.chat_payload->'metadata',
    coalesce(p_provider_message_id, nullif(r.provider_message_id,''))
  )
  returning id into v_chat_id;

  update public.outbound_messages set chat_message_id = v_chat_id where id = p_id;
  return v_chat_id;
exception when others then
  -- A mensagem JA foi entregue. Perder a linha da conversa e grave e precisa gritar, mas nao pode
  -- derrubar o worker nem fazer a mensagem ser reenviada.
  perform public.log_system_error('emissor','chat_log_falhou',
    'Mensagem entregue ao paciente mas NAO registrada na conversa', 'error', r.clinic_id,
    jsonb_build_object('outbound_id', p_id, 'lead_id', r.lead_id, 'erro', sqlerrm), false);
  return null;
end $function$;

revoke all on function public.emit_message(uuid, text, text, text, text, uuid, text, text, text, text, text, integer, text, text, timestamptz, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.emit_message(uuid, text, text, text, text, uuid, text, text, text, text, text, integer, text, text, timestamptz, jsonb, text, text) to service_role;

revoke all on function public.outbound_register_chat(uuid, text) from public, anon, authenticated;
grant execute on function public.outbound_register_chat(uuid, text) to service_role;
