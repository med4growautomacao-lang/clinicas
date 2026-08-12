-- O worker precisa carregar o NOME DO ARQUIVO para documentos (docName na uazapi). Sem isto, o
-- orcamento em PDF (send-quote) chegaria com nome generico. Adiciona a coluna e um parametro em
-- emit_message. Append no FIM da assinatura de proposito: as chamadas nomeadas (produtores) e as
-- posicionais (testes pgTAP, 16 args) seguem validas sem tocar em nada.

alter table public.outbound_messages add column if not exists media_filename text;

drop function if exists public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,int,text,text,timestamptz,jsonb);

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
  p_chat_payload  jsonb       default null,
  p_media_filename text        default null
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

  v_addr := case
              when p_to_kind = 'lead' then coalesce(normalize_br_phone(p_to_addr), btrim(p_to_addr))
              else btrim(p_to_addr)
            end;

  if p_lead_id is not null then
    select coalesce(is_simulation, false) into v_simulado from public.leads where id = p_lead_id;
  end if;
  v_transport := coalesce(p_transport, case when v_simulado then 'sandbox' else 'uazapi' end);

  insert into public.outbound_messages (
    clinic_id, lead_id, to_addr, to_kind, kind, body,
    media_url, media_base64, media_mime, media_kind, media_filename,
    delay_ms, transport, producer, conversation_key, dedup_key, not_before, chat_payload
  ) values (
    p_clinic_id, p_lead_id, v_addr, p_to_kind, p_kind, p_body,
    p_media_url, p_media_base64, p_media_mime, p_media_kind, p_media_filename,
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

revoke all on function public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,int,text,text,timestamptz,jsonb,text) from anon, authenticated;