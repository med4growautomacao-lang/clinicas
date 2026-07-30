-- ============================================================================================
-- BLOQUEIO DE ENVIO PARA NUMERO COMPROVADAMENTE SEM WHATSAPP (decisao do dono, 30/07/2026).
--
-- Ate aqui, um numero confirmado pelo provedor como inexistente continuava recebendo tentativa de
-- toda automacao: 3 tentativas, um alerta CRITICO na Central por vez, e nada entregue. Medido:
-- 21 2022-8426 (reengajamento) e 11 3321-6836 (encerramento de atendimento), ambos telefone FIXO.
--
-- ⚠️ ESTA MUDANCA SILENCIA ENVIO. Sozinha ela seria perigosa: a marca whatsapp_invalid ja errou
-- (ver 20260730141737, seis celulares do Rio) e HOJE NENHUMA TELA a desfaz. O front so LE a coluna
-- (LeadChat.tsx:136, LeadKanban.tsx:4244, AISecretary.tsx:3178) e ainda desabilita o envio manual.
-- Ou seja: marca errada = contato mudo para sempre, sem erro nenhum. Por isso o bloqueio entra
-- junto com DUAS valvulas de escape, e as tres partes sao um pacote so.
--
--   PARTE 1 (gate)     emit_message nao enfileira envio AUTOMATICO para lead marcado.
--   PARTE 2 (valvula)  mensagem recebida do contato limpa a marca: se a pessoa escreveu, ela tem
--                      WhatsApp. Cura o falso positivo no exato momento em que ele apareceria.
--   PARTE 3 (valvula)  trocar o telefone do lead limpa a marca: numero novo, chance nova. E o
--                      unico jeito de a equipe destravar um contato pela tela, ja que nao existe
--                      botao para isso.
--
-- Tirar qualquer uma das partes e deixar as outras reabre o defeito que ela existe para tapar.
--
-- PROVADO em transacao revertida, com o lead real ad3b4b70 (fixo 21 2022-8426, marcado):
--   reengagement -> dropped | ai_agent -> dropped | chat_manual -> pending | send_quote -> pending
--   forms_welcome -> pending | lead nao marcado -> pending | dedup_key da linha bloqueada -> NULO
--   valvula A (ingest_wa_message inbound) -> marca vira false
--   valvula B (update do telefone)        -> marca vira false
-- ============================================================================================


-- ── PARTE 1: o gate ──────────────────────────────────────────────────────────────────────────
-- TRES produtores ficam de FORA, cada um por um motivo diferente:
--
--   chat_manual  e  send_quote  -> disparados por HUMANO clicando na tela agora. Se a atendente
--       sabe que o numero presta, ela tem que poder forcar. O gate nunca decide por cima de uma
--       pessoa que esta olhando o card.
--   forms_welcome -> ele consulta o proprio provedor (/chat/check, com e sem o 9o digito) IMEDIATA-
--       mente antes de emitir, e so DEPOIS de emitir e que zera whatsapp_invalid
--       (forms-welcome-followup/index.ts:335). Barrar aqui mataria justamente o envio que a
--       verificacao ao vivo acabou de aprovar, usando uma marca velha. A checagem dele e prova
--       mais recente que a nossa coluna.
--
-- Envio para grupo e para a operacao (to_kind 'group'/'ops': notify_ops, send_clinic_report,
-- run_system_monitors, comprovante_grupo) nao passa perto do gate, que so olha to_kind='lead'.
--
-- ⚠️ A linha bloqueada e gravada com dedup_key NULO, e isso e load-bearing: a chave e fixa por
-- lead (ex.: 'welcome:<lead>:<balao>'). Se a linha morta segurasse a chave, o `on conflict do
-- nothing` devolveria o id dela para sempre e o contato NUNCA mais receberia aquela mensagem,
-- nem depois de a marca ser desfeita. Mesma armadilha ja documentada em 20260728012257.
create or replace function public.emit_message(
  p_clinic_id uuid, p_to_addr text, p_producer text, p_body text default null::text,
  p_kind text default 'text'::text, p_lead_id uuid default null::uuid,
  p_to_kind text default 'lead'::text, p_media_url text default null::text,
  p_media_base64 text default null::text, p_media_mime text default null::text,
  p_media_kind text default null::text, p_delay_ms integer default 0,
  p_dedup_key text default null::text, p_transport text default null::text,
  p_not_before timestamp with time zone default null::timestamp with time zone,
  p_chat_payload jsonb default null::jsonb, p_media_filename text default null::text,
  p_send_as text default 'clinic'::text, p_menu jsonb default null::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_addr text; v_key text; v_transport text; v_simulado boolean := false; v_id uuid;
  v_bloqueado boolean := false;
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

  -- GATE: numero comprovadamente fora do WhatsApp nao consome fila, tentativa nem alerta.
  if p_to_kind = 'lead' and p_lead_id is not null
     and coalesce(p_producer, '') not in ('chat_manual', 'send_quote', 'forms_welcome') then
    select coalesce(l.whatsapp_invalid, false) into v_bloqueado
      from public.leads l where l.id = p_lead_id;
    v_bloqueado := coalesce(v_bloqueado, false);
  end if;

  insert into public.outbound_messages (
    clinic_id, lead_id, to_addr, to_kind, kind, body,
    media_url, media_base64, media_mime, media_kind, media_filename,
    delay_ms, transport, producer, conversation_key, dedup_key, not_before, chat_payload, send_as,
    menu_payload, status, last_error
  ) values (
    p_clinic_id, p_lead_id, v_addr, p_to_kind, p_kind, p_body,
    p_media_url, p_media_base64, p_media_mime, p_media_kind, p_media_filename,
    coalesce(p_delay_ms, 0), v_transport, p_producer,
    p_clinic_id::text || '|' || v_key,
    case when v_bloqueado then null else p_dedup_key end,
    coalesce(p_not_before, now()), p_chat_payload,
    coalesce(p_send_as, 'clinic'),
    p_menu,
    case when v_bloqueado then 'dropped' else 'pending' end,
    case when v_bloqueado
         then 'lead_sem_whatsapp: contato marcado como fora do WhatsApp, envio automatico nao enfileirado'
         else null end
  )
  on conflict (dedup_key) where dedup_key is not null do nothing
  returning id into v_id;

  if v_id is null and p_dedup_key is not null then
    select id into v_id from public.outbound_messages where dedup_key = p_dedup_key;
  end if;
  -- Devolve o id da linha bloqueada de proposito: o produtor precisa distinguir "nao enfileirei"
  -- de "falhei". Devolver NULL faria o forms-welcome (e parentes) tratar como erro transitorio e
  -- reenfileirar em loop contra um numero que nao existe.
  return v_id;
end $function$;

revoke all on function public.emit_message(uuid, text, text, text, text, uuid, text, text, text, text, text, integer, text, text, timestamptz, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.emit_message(uuid, text, text, text, text, uuid, text, text, text, text, text, integer, text, text, timestamptz, jsonb, text, text, jsonb) to service_role;


-- ── PARTE 2: valvula do inbound ──────────────────────────────────────────────────────────────
-- ⚠️ A limpeza vem ANTES do insert em chat_messages, e a ordem e load-bearing: os triggers AFTER
-- INSERT dessa tabela ja produzem resposta na mesma transacao (fn_handle_confirmation_reply chama
-- emit_message). Limpar depois faria a resposta a quem acabou de escrever bater no gate com a
-- marca velha, que e exatamente o silenciamento que este pacote existe para evitar.
--
-- ⚠️ Fica aqui, e nao num trigger de chat_messages, porque o import do onboarding grava mensagem
-- inbound RETROATIVA direto na tabela (_onboarding_import_run) sem passar por esta RPC. Conversa
-- de meses atras nao prova que o numero funciona HOJE. Conferido: so o wa-inbound chama esta RPC.
create or replace function public.ingest_wa_message(p_instance_token text, p_direction text, p_lead_phone text, p_content text, p_wa_message_id text default null::text, p_lead_name text default null::text, p_sender text default 'human'::text, p_media_kind text default null::text, p_media_mime text default null::text, p_media_path text default null::text, p_media_filename text default null::text, p_media_duration numeric default null::numeric, p_avatar_url text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
$function$;


-- ── PARTE 3: valvula do telefone ─────────────────────────────────────────────────────────────
-- Sem isto o pacote e uma armadilha: nao existe tela que desfaca a marca, e o envio manual fica
-- desabilitado justamente para o lead marcado. Corrigir o numero no cadastro passa a ser o gesto
-- que destrava o contato, que e o que a atendente faria naturalmente.
--
-- Compara NORMALIZADO dos dois lados de proposito: 'update ... set phone = phone' e reescrita com
-- o 9o digito nao sao "numero novo" e nao devem destravar nada (CLAUDE.md §2).
create or replace function public.fn_lead_phone_novo_limpa_whatsapp_invalid()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(new.whatsapp_invalid, false)
     and normalize_br_phone(new.phone) is distinct from normalize_br_phone(old.phone) then
    new.whatsapp_invalid := false;
  end if;
  return new;
end $function$;

drop trigger if exists trg_lead_phone_novo_limpa_whatsapp_invalid on public.leads;
create trigger trg_lead_phone_novo_limpa_whatsapp_invalid
  before update of phone on public.leads
  for each row execute function public.fn_lead_phone_novo_limpa_whatsapp_invalid();
