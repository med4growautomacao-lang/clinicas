-- Motor do Roteiro, parte 2: o turno (a única parte com efeito colateral).
--
-- Reusa o que já existe e é provado: emit_message + Emissor (token pelo gate, retry, DLQ, só grava
-- em chat_messages depois do 200), move_lead_stage, notify_ops, ticket_merge_dados_pre_atendimento
-- e log_system_error. O motor não fala com a uazapi, não resolve token e não retenta envio.

alter table public.chatbot_scripts
  add column if not exists modo_envio text not null default 'menu';
alter table public.chatbot_scripts
  drop constraint if exists chatbot_scripts_modo_envio_check;
alter table public.chatbot_scripts
  add constraint chatbot_scripts_modo_envio_check check (modo_envio in ('menu','texto'));
alter table public.chatbot_scripts
  add column if not exists max_tentativas int not null default 2;

-- ── Este contato deve ser atendido pelo roteiro? ───────────────────────────────────────────────
-- `test_numbers` VAZIO significa produção para todos os contatos. Com números, só eles: é isso que
-- permite testar em produção sem tirar o agente dos outros contatos da clínica.
create or replace function public.fn_chatbot_script_ativo(p_clinic_id uuid, p_phone_norm text)
returns uuid language sql stable security definer
set search_path to 'public'
as $$
  select s.id from public.chatbot_scripts s
   where s.clinic_id = p_clinic_id
     and s.ativo
     and s.versao_publicada is not null
     and (coalesce(array_length(s.test_numbers, 1), 0) = 0
          or exists (select 1 from unnest(s.test_numbers) t
                      where public.normalize_br_phone(t) = p_phone_norm))
   limit 1
$$;

-- ── A ficha do vendedor ────────────────────────────────────────────────────────────────────────
-- ⚠️ VITRINE, nunca estado: quem guarda a verdade é chatbot_sessions.respostas. Mandamos SEMPRE o
-- conjunto completo, e como os itens novos entram primeiro no merge, o teto de 15 nunca derruba um
-- campo do roteiro. A validação da publicação limita o roteiro a 10 campos justamente para sobrar
-- espaço na ficha para o que vier de outro lugar.
create or replace function public.fn_chatbot_ficha(p_ticket_id uuid, p_definicao jsonb, p_respostas jsonb)
returns void language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_itens jsonb; v_resumo text;
begin
  select coalesce(jsonb_agg(jsonb_build_object('campo', x.campo, 'valor', x.valor) order by x.ord), '[]'::jsonb),
         string_agg(x.campo || ': ' || x.valor, ', ' order by x.ord)
    into v_itens, v_resumo
    from (
      select coalesce(p.item->>'rotulo_ficha', p.item->>'slug') as campo,
             coalesce(p_respostas->(p.item->>'slug')->>'rotulo',
                      p_respostas->(p.item->>'slug')->>'valor')  as valor,
             p.ord
        from jsonb_array_elements(coalesce(p_definicao->'passos','[]'::jsonb)) with ordinality p(item, ord)
       where p_respostas ? (p.item->>'slug')
         and coalesce(p.item->>'tipo','') <> 'acao'
    ) x;

  if v_itens is null or jsonb_array_length(v_itens) = 0 then return; end if;
  perform public.ticket_merge_dados_pre_atendimento(p_ticket_id, v_resumo, v_itens);
end $$;

-- ── Manda a pergunta e guarda o que foi apresentado ────────────────────────────────────────────
create or replace function public.fn_chatbot_apresentar(
  p_session_id uuid, p_clinic_id uuid, p_lead_id uuid, p_phone text,
  p_passo jsonb, p_modo text, p_prefixo text default null, p_tentativa int default 0)
returns uuid language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_r jsonb; v_body text; v_out uuid; v_dedup text; v_midia text; v_payload jsonb;
begin
  v_r    := public.fn_chatbot_render(p_passo, p_modo);
  v_body := coalesce(p_prefixo, '') || coalesce(v_r->>'body', '');
  -- Chave de repetição: é ela que faz a rajada ("oi" / "bom dia" / "queria orçamento") virar UMA
  -- pergunta em vez de três. Muda quando a tentativa muda, então repetir de propósito funciona.
  v_dedup := 'chatbot:' || p_session_id::text || ':' || coalesce(p_passo->>'slug','?') || ':' || p_tentativa::text;
  v_midia := nullif(p_passo->>'midia_url', '');

  v_payload := jsonb_build_object('sender', 'system', 'message', jsonb_build_object(
    'type','system','content', v_body,
    'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb));

  -- A foto só cabe DENTRO do menu quando ele é de botão (imageButton). Em lista e em texto ela vai
  -- como mensagem de mídia logo antes, e a ordem chega garantida porque a fila do Emissor é
  -- ordenada por conversa.
  if v_midia is not null and not (v_r->>'kind' = 'menu' and (v_r->'menu'->>'type') = 'button') then
    perform public.emit_message(
      p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
      p_kind => 'media', p_media_url => v_midia, p_media_kind => 'image',
      p_lead_id => p_lead_id, p_dedup_key => v_dedup || ':foto');
  end if;

  if v_r->>'kind' = 'menu' then
    v_out := public.emit_message(
      p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
      p_kind => 'menu', p_menu => (v_r->'menu') || jsonb_build_object('text', v_body),
      p_body => v_body, p_lead_id => p_lead_id, p_dedup_key => v_dedup, p_chat_payload => v_payload);
  else
    v_out := public.emit_message(
      p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
      p_kind => 'text', p_body => v_body, p_lead_id => p_lead_id,
      p_dedup_key => v_dedup, p_chat_payload => v_payload);
  end if;

  update public.chatbot_sessions
     set aguardando = jsonb_build_object(
           'passo', p_passo->>'slug', 'opcoes', coalesce(v_r->'opcoes','[]'::jsonb),
           'kind', v_r->>'kind', 'em', to_jsonb(now()), 'outbound_id', v_out),
         ultima_interacao_em = now()
   where id = p_session_id;

  insert into public.chatbot_events (clinic_id, session_id, passo, tipo, outbound_id, detalhe)
  values (p_clinic_id, p_session_id, p_passo->>'slug', 'apresentado', v_out,
          jsonb_build_object('kind', v_r->>'kind', 'tentativa', p_tentativa));

  return v_out;
end $$;

-- ── O TURNO ────────────────────────────────────────────────────────────────────────────────────
-- Chamada de dentro de ingest_wa_message, na MESMA transação da mensagem recebida.
-- Devolve {atendeu, acao, passo}. `atendeu=true` significa "o roteiro respondeu, não chame a IA".
create or replace function public.fn_chatbot_turno(
  p_clinic_id uuid, p_lead_id uuid, p_phone text, p_texto text, p_button_id text default null)
returns jsonb language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_script_id uuid; v_s public.chatbot_scripts; v_def jsonb; v_ticket uuid;
  v_sess public.chatbot_sessions; v_nova boolean := false;
  v_passo jsonb; v_prox jsonb; v_match jsonb;
  v_valor text; v_rotulo text; v_resp jsonb; v_idade interval; v_msg text;
begin
  v_script_id := public.fn_chatbot_script_ativo(p_clinic_id, p_phone);
  if v_script_id is null then return jsonb_build_object('atendeu', false, 'motivo', 'sem_roteiro'); end if;

  select * into v_s from public.chatbot_scripts where id = v_script_id;
  select definicao into v_def from public.chatbot_versions
   where script_id = v_s.id and versao = v_s.versao_publicada;

  if v_def is null then
    perform public.log_system_error('chatbot', 'roteiro_sem_versao',
      'O roteiro está ligado mas a versão publicada não existe: o contato ficou sem resposta',
      'critical', p_clinic_id,
      jsonb_build_object('script_id', v_s.id, 'versao', v_s.versao_publicada, 'telefone', p_phone), false);
    return jsonb_build_object('atendeu', false, 'motivo', 'sem_versao');
  end if;

  -- Ticket ABERTO do lead (status='open', igual ao índice uq_tickets_one_open_per_lead). A trigger
  -- de chat_messages já criou o dele antes de chegarmos aqui.
  select id into v_ticket from public.tickets
   where lead_id = p_lead_id and status = 'open' order by created_at desc limit 1;
  if v_ticket is null then return jsonb_build_object('atendeu', false, 'motivo', 'sem_ticket'); end if;

  select * into v_sess from public.chatbot_sessions
   where ticket_id = v_ticket and status = 'aguardando' for update;

  if v_sess.id is null then
    begin
      insert into public.chatbot_sessions (clinic_id, lead_id, ticket_id, script_id, versao)
      values (p_clinic_id, p_lead_id, v_ticket, v_s.id, v_s.versao_publicada)
      returning * into v_sess;
      v_nova := true;
    exception when unique_violation then
      -- Duas mensagens do mesmo contato no mesmo instante: a trava por índice fez o trabalho dela.
      select * into v_sess from public.chatbot_sessions
       where ticket_id = v_ticket and status = 'aguardando' for update;
    end;
  end if;
  if v_sess.id is null then return jsonb_build_object('atendeu', false, 'motivo', 'sem_sessao'); end if;

  -- ── Primeira mensagem: só apresenta, não tenta casar nada ────────────────────────────────────
  if v_nova or v_sess.aguardando is null then
    v_prox := public.fn_chatbot_passo_atual(v_def, v_sess.respostas);
    if v_prox is null then return jsonb_build_object('atendeu', false, 'motivo', 'roteiro_vazio'); end if;
    perform public.fn_chatbot_apresentar(v_sess.id, p_clinic_id, p_lead_id, p_phone,
                                         v_prox, v_s.modo_envio, null, 0);
    return jsonb_build_object('atendeu', true, 'acao', 'apresentou', 'passo', v_prox->>'slug');
  end if;

  select e.item into v_passo from jsonb_array_elements(v_def->'passos') e(item)
   where e.item->>'slug' = v_sess.aguardando->>'passo' limit 1;
  if v_passo is null then
    -- Não deveria acontecer (a sessão fica pinada na versão), mas não pode travar o contato.
    update public.chatbot_sessions set aguardando = null where id = v_sess.id;
    return jsonb_build_object('atendeu', false, 'motivo', 'passo_sumiu');
  end if;

  -- ── Casar a resposta ─────────────────────────────────────────────────────────────────────────
  v_match := public.fn_chatbot_casar(v_sess.aguardando, p_texto, p_button_id);
  if v_match is not null then
    v_valor := v_match->>'id'; v_rotulo := v_match->>'rotulo';
  elsif coalesce(v_passo->>'tipo','') = 'texto'
        and coalesce(btrim(p_texto), '') <> ''
        -- ⚠️ Sem esta guarda, "vocês entregam em Passos?" digitado no passo da Cidade viraria a
        -- cidade do cliente, e o vendedor receberia uma ficha completa, confiante e errada.
        and not public.fn_chatbot_parece_pergunta(p_texto) then
    v_valor := btrim(p_texto); v_rotulo := btrim(p_texto);
  end if;

  -- ── Não casou ────────────────────────────────────────────────────────────────────────────────
  if v_valor is null then
    v_idade := now() - coalesce((v_sess.aguardando->>'em')::timestamptz, now() - interval '1 hour');

    -- Rajada: mensagens que chegam logo depois da pergunta são conversa solta, não fracasso.
    -- Sem isto, quem escreve "oi", "bom dia", "queria um orçamento" gasta as tentativas antes de
    -- ler a primeira pergunta, e o robô se cala justamente no contato mais quente.
    if v_idade < interval '12 seconds' then
      return jsonb_build_object('atendeu', true, 'acao', 'ignorou_rajada');
    end if;

    insert into public.chatbot_events (clinic_id, session_id, passo, tipo, detalhe)
    values (p_clinic_id, v_sess.id, v_passo->>'slug', 'nao_casou',
            jsonb_build_object('texto', left(coalesce(p_texto,''), 200),
                               'tentativa', v_sess.tentativas_passo + 1));

    -- Estourou as tentativas: sem IA no caminho, a saída é GENTE.
    if v_sess.tentativas_passo + 1 >= v_s.max_tentativas then
      v_msg := coalesce(nullif(v_def->'humano'->>'mensagem', ''),
                        'Vou chamar uma pessoa da equipe para te atender, tudo bem? Já te respondem por aqui.');
      perform public.emit_message(
        p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
        p_kind => 'text', p_body => v_msg, p_lead_id => p_lead_id,
        p_dedup_key => 'chatbot:' || v_sess.id::text || ':humano',
        p_chat_payload => jsonb_build_object('sender','system','message', jsonb_build_object(
          'type','system','content', v_msg,'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb)));

      perform public.fn_chatbot_ficha(v_ticket, v_def, v_sess.respostas);
      update public.chatbot_sessions
         set status = 'encerrado', aguardando = null, ultima_interacao_em = now()
       where id = v_sess.id;
      insert into public.chatbot_events (clinic_id, session_id, passo, tipo)
      values (p_clinic_id, v_sess.id, v_passo->>'slug', 'entregue_humano');

      perform public.notify_ops(
        p_clinic_id => p_clinic_id, p_event => 'chatbot_precisa_de_gente',
        p_title => 'Contato saiu do roteiro e precisa de atendimento',
        p_body  => 'O contato respondeu algo que o roteiro não entendeu duas vezes na pergunta "'
                   || coalesce(v_passo->>'rotulo_ficha', v_passo->>'slug') || '".',
        p_level => 'warning', p_lead_id => p_lead_id, p_ticket_id => v_ticket,
        p_payload => jsonb_build_object('passo', v_passo->>'slug'), p_notify_group => true);

      return jsonb_build_object('atendeu', true, 'acao', 'entregue_humano');
    end if;

    update public.chatbot_sessions
       set tentativas_passo = tentativas_passo + 1, ultima_interacao_em = now()
     where id = v_sess.id;
    perform public.fn_chatbot_apresentar(v_sess.id, p_clinic_id, p_lead_id, p_phone, v_passo,
              v_s.modo_envio, 'Não entendi. ', v_sess.tentativas_passo + 1);
    return jsonb_build_object('atendeu', true, 'acao', 'repetiu', 'passo', v_passo->>'slug');
  end if;

  -- ── Casou: grava e segue ─────────────────────────────────────────────────────────────────────
  v_resp := coalesce(v_sess.respostas, '{}'::jsonb) || jsonb_build_object(
              v_passo->>'slug',
              jsonb_build_object('valor', v_valor, 'rotulo', v_rotulo, 'em', to_jsonb(now())));

  update public.chatbot_sessions
     set respostas = v_resp, tentativas_passo = 0, aguardando = null, ultima_interacao_em = now()
   where id = v_sess.id;

  insert into public.chatbot_events (clinic_id, session_id, passo, tipo, detalhe)
  values (p_clinic_id, v_sess.id, v_passo->>'slug', 'casado',
          jsonb_build_object('valor', v_valor, 'clique', p_button_id is not null));

  -- Ficha a cada resposta: o card do Kanban enche durante a conversa, então contato que abandona
  -- no meio já chega ao vendedor com o que respondeu.
  perform public.fn_chatbot_ficha(v_ticket, v_def, v_resp);

  v_prox := public.fn_chatbot_passo_atual(v_def, v_resp);

  if v_prox is not null and coalesce(v_prox->>'tipo','') <> 'acao' then
    perform public.fn_chatbot_apresentar(v_sess.id, p_clinic_id, p_lead_id, p_phone,
                                         v_prox, v_s.modo_envio, null, 0);
    return jsonb_build_object('atendeu', true, 'acao', 'apresentou', 'passo', v_prox->>'slug');
  end if;

  -- ── Fim do roteiro (ou passo de ação): entrega ao especialista ───────────────────────────────
  v_msg := coalesce(nullif(v_prox->>'pergunta', ''), nullif(v_def->'fim'->>'mensagem', ''),
                    'Prontinho! Já passei suas informações para o nosso especialista, ele vai te responder por aqui o mais breve possível.');

  perform public.emit_message(
    p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
    p_kind => 'text', p_body => v_msg, p_lead_id => p_lead_id,
    p_dedup_key => 'chatbot:' || v_sess.id::text || ':fim',
    p_chat_payload => jsonb_build_object('sender','system','message', jsonb_build_object(
      'type','system','content', v_msg,'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb)));

  -- ⚠️ Etapa de desfecho é PROIBIDA como destino e isso é validado na publicação: mover para
  -- 'ganho' faz a trigger de consistência gravar venda e faturamento sozinha.
  if v_s.etapa_destino_id is not null then
    perform public.move_lead_stage(v_ticket, v_s.etapa_destino_id);
  end if;

  update public.chatbot_sessions
     set status = 'transferido', aguardando = null, ultima_interacao_em = now()
   where id = v_sess.id;
  insert into public.chatbot_events (clinic_id, session_id, passo, tipo)
  values (p_clinic_id, v_sess.id, coalesce(v_prox->>'slug','fim'), 'transferido');

  perform public.notify_ops(
    p_clinic_id => p_clinic_id, p_event => 'chatbot_roteiro_concluido',
    p_title => 'Pedido de orçamento pronto pelo roteiro',
    p_body  => coalesce((select string_agg(coalesce(p.item->>'rotulo_ficha', p.item->>'slug') || ': '
                          || coalesce(v_resp->(p.item->>'slug')->>'rotulo', ''), ', ' order by p.ord)
                          from jsonb_array_elements(v_def->'passos') with ordinality p(item, ord)
                         where v_resp ? (p.item->>'slug')), 'Roteiro concluído.'),
    p_level => 'info', p_lead_id => p_lead_id, p_ticket_id => v_ticket,
    p_payload => jsonb_build_object('respostas', v_resp), p_notify_group => true);

  return jsonb_build_object('atendeu', true, 'acao', 'transferido');
exception when others then
  -- Nunca derrubar a ingestão da mensagem por causa do roteiro: a conversa tem que ser gravada de
  -- qualquer jeito. Acende na Central e devolve atendeu=false, e aí o contato cai no caminho normal.
  begin
    perform public.log_system_error('chatbot', 'turno_falhou',
      'O roteiro quebrou ao processar a mensagem e o contato pode ter ficado sem resposta',
      'critical', p_clinic_id,
      jsonb_build_object('telefone', p_phone, 'lead_id', p_lead_id, 'erro', sqlerrm), false);
  exception when others then null;
  end;
  return jsonb_build_object('atendeu', false, 'motivo', 'erro');
end $$;

revoke all on function public.fn_chatbot_script_ativo(uuid, text)          from public, anon, authenticated;
revoke all on function public.fn_chatbot_ficha(uuid, jsonb, jsonb)         from public, anon, authenticated;
revoke all on function public.fn_chatbot_apresentar(uuid, uuid, uuid, text, jsonb, text, text, int) from public, anon, authenticated;
revoke all on function public.fn_chatbot_turno(uuid, uuid, text, text, text) from public, anon, authenticated;
