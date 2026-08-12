-- Corrige outbound_register_chat: a versao anterior escrevia numa coluna `type` que NAO existe em
-- chat_messages (as colunas reais sao id, clinic_id, lead_id, patient_id, direction, sender,
-- phone, metadata, created_at, user_id, session_id, message, clinic_name, ticket_id, seq,
-- wa_message_id). Quebraria na primeira mensagem entregue. Nenhum chamador existia ainda.
--
-- Ganho de brinde: `wa_message_id` passa a receber o id que a uazapi devolve, amarrando a linha da
-- conversa a mensagem real no WhatsApp. Nenhum dos 13 produtores faz isso hoje.
-- `session_id`, `clinic_name` e `seq` continuam vindo por trigger, como no resto do sistema.

create or replace function public.outbound_register_chat(
  p_id uuid,
  p_provider_message_id text default null
)
returns uuid
language plpgsql security definer set search_path to 'public'
as $$
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
    coalesce(nullif(r.chat_payload->>'phone',''), r.to_addr),
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
end $$;

revoke all on function public.outbound_register_chat(uuid,text) from anon, authenticated;