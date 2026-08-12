-- 20260723173208_20260723174500_emissor_chat_payload
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Quem grava em chat_messages passa a ser o EMISSOR, e so DEPOIS de o provedor confirmar.
--
-- Este e o coracao da correcao. Hoje os 13 produtores gravam a mensagem na conversa
-- INCONDICIONALMENTE, logo apos disparar um POST assincrono que ninguem le. Se a uazapi recusa,
-- o painel mostra "enviado", o paciente nunca recebeu, e nao ha como saber.
--
-- Mas cada produtor grava um registro diferente (o manual tem user_id, o do agente e sender='ai',
-- a automacao e 'system', o relatorio para grupo nao e conversa nenhuma). Em vez de o Emissor
-- adivinhar, o PRODUTOR monta o registro que quer ver gravado e entrega junto; o Emissor so
-- decide QUANDO grava-lo: depois do 200. `chat_payload` nulo = nao registra na conversa.

alter table public.outbound_messages add column if not exists chat_payload jsonb;

comment on column public.outbound_messages.chat_payload is
  'Registro que o produtor quer gravar em chat_messages. O Emissor so insere DEPOIS de o provedor confirmar a entrega. Nulo = nao registrar (ex.: aviso para grupo interno).';

-- Recria emit_message com o parametro novo. DROP antes de propósito: adicionar parametro com
-- default criaria uma SOBRECARGA e toda chamada viraria ambigua. Seguro porque nenhum produtor
-- usa a funcao ainda (a chave esta desligada).
drop function if exists public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,int,text,text,timestamptz);

create or replace function public.emit_message(
  p_clinic_id     uuid,
  p_to_addr       text,
  p_producer      text,
  p_body          text        default null,
  p_kind          text        default 'text',
  p_lead_id       uuid        default null,
  p_to_kind       text        default 'lead',
  p_media_url     text        default null,
  p_media_base64  text        default null,
  p_media_mime    text        default null,
  p_media_kind    text        default null,
  p_delay_ms      int         default 0,
  p_dedup_key     text        default null,
  p_transport     text        default null,
  p_not_before    timestamptz default null,
  p_chat_payload  jsonb       default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_addr      text;
  v_transport text;
  v_simulado  boolean := false;
  v_id        uuid;
begin
  if p_clinic_id is null or coalesce(btrim(p_to_addr), '') = '' then
    raise exception 'emit_message: clinic_id e to_addr sao obrigatorios';
  end if;

  -- Normaliza UM lado so, aqui, de uma vez por todas. Hoje cada produtor faz diferente:
  -- fn_handle_confirmation_reply normaliza, process_pos_followup manda cru. Grupo nao e telefone.
  v_addr := case
              when p_to_kind = 'lead' then coalesce(normalize_br_phone(p_to_addr), btrim(p_to_addr))
              else btrim(p_to_addr)
            end;

  -- Transporte: explicito ganha; senao, lead de simulacao nunca toca a uazapi.
  if p_lead_id is not null then
    select coalesce(is_simulation, false) into v_simulado from public.leads where id = p_lead_id;
  end if;
  v_transport := coalesce(p_transport, case when v_simulado then 'sandbox' else 'uazapi' end);

  insert into public.outbound_messages (
    clinic_id, lead_id, to_addr, to_kind, kind, body,
    media_url, media_base64, media_mime, media_kind,
    delay_ms, transport, producer, conversation_key, dedup_key, not_before, chat_payload
  ) values (
    p_clinic_id, p_lead_id, v_addr, p_to_kind, p_kind, p_body,
    p_media_url, p_media_base64, p_media_mime, p_media_kind,
    coalesce(p_delay_ms, 0), v_transport, p_producer,
    p_clinic_id::text || '|' || v_addr, p_dedup_key, coalesce(p_not_before, now()), p_chat_payload
  )
  on conflict (dedup_key) where dedup_key is not null do nothing
  returning id into v_id;

  if v_id is null and p_dedup_key is not null then
    select id into v_id from public.outbound_messages where dedup_key = p_dedup_key;
  end if;

  return v_id;
end $$;

revoke all on function public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,int,text,text,timestamptz,jsonb) from anon, authenticated;

-- Grava a conversa a partir do chat_payload. Fica no BANCO (e nao no worker) porque a perda desta
-- linha e o unico erro que nao pode acontecer depois de a mensagem ja ter saido: a mensagem foi
-- entregue ao paciente e a conversa precisa refleti-la. Aqui e uma transacao so.
create or replace function public.outbound_register_chat(p_id uuid)
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
    clinic_id, lead_id, phone, direction, sender, message, user_id, type
  ) values (
    r.clinic_id,
    coalesce((r.chat_payload->>'lead_id')::uuid, r.lead_id),
    coalesce(r.chat_payload->>'phone', r.to_addr),
    'outbound',
    coalesce(r.chat_payload->>'sender', 'system'),
    coalesce(r.chat_payload->'message',
             jsonb_build_object('type', coalesce(r.chat_payload->>'type','system'), 'content', r.body)),
    nullif(r.chat_payload->>'user_id','')::uuid,
    nullif(r.chat_payload->>'type','')
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

revoke all on function public.outbound_register_chat(uuid) from anon, authenticated;
