-- Emissor: suporte a MENU INTERATIVO (/send/menu da uazapi).
--
-- Por que: `process_confirmation_reminders` (lembrete de confirmacao com os botoes Confirmar /
-- Remarcar / Cancelar) era o UNICO produtor de saida que nunca passou pela fila. Ele mandava
-- direto por system_http_post, entao: sem re-tentativa, sem leitura da resposta, e gravando em
-- chat_messages mesmo quando a uazapi recusava. Ligar a chave do Emissor para todos NAO o traria
-- junto; ele ficaria fora para sempre. Esta migration abre o caminho.
--
-- Formato conforme a documentacao oficial (https://docs.uazapi.com/endpoint/post/send~menu):
--   obrigatorios: number, type ('button'|'list'|'poll'|'carousel'), text, choices[]
--   opcionais uteis: footerText, listButton, selectableCount, imageButton, delay
--   choices de botao aceitam "texto|id", "texto|copy:codigo", "texto|call:+55...", "texto|url:..."
--
-- Guardamos os campos ESPECIFICOS do menu num jsonb proprio em vez de espalhar 5 colunas novas:
-- o worker mescla {number, delay} por cima na hora do envio. Assim list/poll/carousel entram
-- depois sem nova migration de schema.

alter table public.outbound_messages
  add column if not exists menu_payload jsonb;

comment on column public.outbound_messages.menu_payload is
  'Campos especificos do /send/menu da uazapi (type, text, choices, footerText, listButton, selectableCount, imageButton). O worker adiciona number e delay. So usado quando kind = ''menu''.';

-- Trava de integridade: kind='menu' sem payload e mensagem que nunca vai sair, e hoje isso so
-- apareceria como falha 3x + alerta critico. Melhor recusar no enfileiramento.
alter table public.outbound_messages
  drop constraint if exists outbound_messages_menu_exige_payload;
alter table public.outbound_messages
  add constraint outbound_messages_menu_exige_payload
  check (kind <> 'menu' or (menu_payload is not null and menu_payload ? 'choices'));

-- emit_message ganha p_menu. Precisa de DROP antes: CREATE OR REPLACE com lista de argumentos
-- diferente criaria uma SEGUNDA funcao (sobrecarga), e como todos os produtores chamam por nome
-- de parametro, as chamadas antigas passariam a dar "function is not unique". Roda em transacao,
-- entao nao ha janela em que a funcao nao exista.
drop function if exists public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,integer,text,text,timestamptz,jsonb,text,text);

create or replace function public.emit_message(
  p_clinic_id uuid,
  p_to_addr text,
  p_producer text,
  p_body text default null,
  p_kind text default 'text',
  p_lead_id uuid default null,
  p_to_kind text default 'lead',
  p_media_url text default null,
  p_media_base64 text default null,
  p_media_mime text default null,
  p_media_kind text default null,
  p_delay_ms integer default 0,
  p_dedup_key text default null,
  p_transport text default null,
  p_not_before timestamptz default null,
  p_chat_payload jsonb default null,
  p_media_filename text default null,
  p_send_as text default 'clinic',
  p_menu jsonb default null
) returns uuid
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
    delay_ms, transport, producer, conversation_key, dedup_key, not_before, chat_payload, send_as,
    menu_payload
  ) values (
    p_clinic_id, p_lead_id, v_addr, p_to_kind, p_kind, p_body,
    p_media_url, p_media_base64, p_media_mime, p_media_kind, p_media_filename,
    coalesce(p_delay_ms, 0), v_transport, p_producer,
    p_clinic_id::text || '|' || v_key, p_dedup_key, coalesce(p_not_before, now()), p_chat_payload,
    coalesce(p_send_as, 'clinic'),
    p_menu
  )
  on conflict (dedup_key) where dedup_key is not null do nothing
  returning id into v_id;

  if v_id is null and p_dedup_key is not null then
    select id into v_id from public.outbound_messages where dedup_key = p_dedup_key;
  end if;
  return v_id;
end $function$;

-- Backend-only, como era antes do drop (conferido: anon=false, authenticated=false).
-- O `create function` reconcede EXECUTE ao PUBLIC, entao revogar dos tres e obrigatorio:
-- revogar so de anon deixa o grant de PUBLIC de pe.
revoke all on function public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,integer,text,text,timestamptz,jsonb,text,text,jsonb) from public, anon, authenticated;
