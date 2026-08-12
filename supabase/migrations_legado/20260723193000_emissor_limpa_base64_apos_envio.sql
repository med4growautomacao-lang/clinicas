-- Zera o media_base64 DEPOIS de entregue. O audio do agente (Opcao A) enfileira o MP3 em base64
-- (~65-400 KB por mensagem de voz). Sem isto, esse blob ficaria na outbound_messages ate a purga de
-- 30 dias, inchando a tabela. Uma vez entregue (ou simulado), o base64 e peso morto: a auditoria
-- guarda status/provider_response/chat_message_id, nao precisa do binario. media_url (pequeno) fica.

create or replace function public.mark_outbound_sent(
  p_id uuid,
  p_provider_status int default null,
  p_provider_message_id text default null,
  p_provider_response jsonb default null,
  p_chat_message_id uuid default null,
  p_simulated boolean default false
) returns void
language sql security definer set search_path to 'public'
as $$
  update public.outbound_messages
     set status = case when p_simulated then 'simulated' else 'sent' end,
         sent_at = now(),
         provider_status = p_provider_status,
         provider_message_id = p_provider_message_id,
         provider_response = p_provider_response,
         chat_message_id = coalesce(p_chat_message_id, chat_message_id),
         media_base64 = null,   -- entregue: solta o binario (bounded storage)
         last_error = null
   where id = p_id;
$$;