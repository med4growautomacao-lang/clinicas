-- normalize_br_phone faz DUAS coisas de uma vez: limpa o numero (mascara, zeros, DDI faltando) e
-- impoe o formato canonico de 12 digitos, REMOVENDO o 9o. A primeira parte todo destino precisa;
-- a segunda so serve para chave de comparacao, e destroi o endereco de entrega quando o numero so
-- existe no WhatsApp COM o 9.
--
-- Esta funcao e a metade util para quem vai discar: limpa e completa o DDI, nunca mexe no 9.
create or replace function public.normalize_wa_addr(p_phone text)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare v text;
begin
  if p_phone is null then return null; end if;
  v := regexp_replace(p_phone, '[^0-9]', '', 'g');
  if v = '' then return null; end if;
  v := regexp_replace(v, '^0+', '');
  if v = '' then return null; end if;
  -- 10 (fixo/celular antigo) ou 11 (celular com 9) sem DDI -> completa o 55.
  -- Numero que ja chega com DDI (12/13) ou estrangeiro passa intacto.
  if length(v) in (10, 11) then v := '55' || v; end if;
  return v;
end $function$;

comment on function public.normalize_wa_addr(text) is
  'Limpa telefone para DISCAR (mascara, zeros a esquerda, DDI faltando) preservando o 9o digito. Para chave de comparacao use normalize_br_phone, que remove o 9.';

-- emit_message: aplica a limpeza defensiva no destino (chat_manual, por exemplo, vem do front e
-- pode chegar com mascara) sem desfazer o 9 de quem resolveu o numero no WhatsApp.
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

  -- DESTINO: limpo, mas com o 9 preservado. Se o chamador resolveu o numero no WhatsApp
  -- (forms-welcome-followup faz /chat/check com e sem 9), e esse que tem que sair.
  v_addr := case when p_to_kind = 'lead'
                 then coalesce(normalize_wa_addr(p_to_addr), btrim(p_to_addr))
                 else btrim(p_to_addr) end;

  -- CHAVE DE CONVERSA: canonica (sem o 9), para o mesmo contato cair sempre na mesma fila
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

revoke all on function public.normalize_wa_addr(text) from public, anon, authenticated;
grant execute on function public.normalize_wa_addr(text) to service_role;

revoke all on function public.emit_message(uuid, text, text, text, text, uuid, text, text, text, text, text, integer, text, text, timestamptz, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.emit_message(uuid, text, text, text, text, uuid, text, text, text, text, text, integer, text, text, timestamptz, jsonb, text, text) to service_role;
