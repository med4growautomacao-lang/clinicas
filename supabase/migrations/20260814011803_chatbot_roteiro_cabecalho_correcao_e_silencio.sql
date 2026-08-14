-- Três correções vindas do primeiro teste real (13/08/2026, no WhatsApp do dono).
--
-- 1) A PERGUNTA NÃO CHEGAVA NO CELULAR. Provado no `provider_response` da uazapi: ela quebra o
--    nosso texto na primeira quebra de linha e promove a PRIMEIRA LINHA a `header.title` de um
--    NativeFlowMessage. O menu de entrada (primeira linha de 77 caracteres) renderizou no celular
--    do dono; a pergunta da malha (101) só renderizou no WhatsApp Web. Mandando o texto com uma
--    quebra de linha NA FRENTE, o cabeçalho sai vazio e a mensagem inteira vai no corpo, que é a
--    forma mais compatível. Isso não está documentado em https://docs.uazapi.com/.
--
-- 2) CLIQUE EM BOTÃO ANTIGO VIRAVA "NÃO ENTENDI". No WhatsApp a mensagem antiga continua clicável,
--    então quem não vê a pergunta nova toca no menu anterior. O sistema respondia "Não entendi",
--    gastava tentativa e chamava a equipe. É a resposta errada duas vezes: para o clique velho E
--    para quem simplesmente mudou de ideia. Agora isso é tratado como CORREÇÃO.
--
-- 3) O ROTEIRO VOLTAVA A PERGUNTAR DEPOIS DE CHAMAR A EQUIPE. A busca de sessão só olhava
--    `status='aguardando'`, então a sessão encerrada era ignorada e uma nova nascia na mensagem
--    seguinte: o robô interrompia o vendedor que tinha acabado de ser chamado.

-- ── 1) Cabeçalho vazio ─────────────────────────────────────────────────────────────────────────
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
  v_dedup := 'chatbot:' || p_session_id::text || ':' || coalesce(p_passo->>'slug','?') || ':' || p_tentativa::text;
  v_midia := nullif(p_passo->>'midia_url', '');

  v_payload := jsonb_build_object('sender', 'system', 'message', jsonb_build_object(
    'type','system','content', v_body,
    'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb));

  if v_midia is not null and not (v_r->>'kind' = 'menu' and (v_r->'menu'->>'type') = 'button') then
    perform public.emit_message(
      p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
      p_kind => 'media', p_media_url => v_midia, p_media_kind => 'image',
      p_lead_id => p_lead_id, p_dedup_key => v_dedup || ':foto');
  end if;

  if v_r->>'kind' = 'menu' then
    v_out := public.emit_message(
      p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
      -- ⚠️ A quebra de linha da frente é o que mantém o cabeçalho VAZIO (ver comentário no topo).
      -- Não tire: sem ela, pergunta com primeira linha longa some no celular de parte dos contatos,
      -- e some em silêncio, com a uazapi devolvendo 200.
      p_kind => 'menu', p_menu => (v_r->'menu') || jsonb_build_object('text', E'\n' || v_body),
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

-- ── 2 e 3) Correção e silêncio depois da entrega ───────────────────────────────────────────────
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
  v_ant_slug text; v_ant_op jsonb; v_k text; v_pk jsonb; v_mudou boolean;
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

  select id into v_ticket from public.tickets
   where lead_id = p_lead_id and status = 'open' order by created_at desc limit 1;
  if v_ticket is null then return jsonb_build_object('atendeu', false, 'motivo', 'sem_ticket'); end if;

  -- ⚠️ QUALQUER sessão do ticket, não só a aberta. Filtrar por 'aguardando' fazia a sessão
  -- encerrada ser ignorada e uma nova nascer na mensagem seguinte: o robô voltava a perguntar por
  -- cima do vendedor que ele mesmo tinha acabado de chamar.
  select * into v_sess from public.chatbot_sessions
   where ticket_id = v_ticket order by created_at desc limit 1 for update;

  if v_sess.id is not null and v_sess.status <> 'aguardando' then
    return jsonb_build_object('atendeu', false, 'motivo', 'sessao_' || v_sess.status);
  end if;

  if v_sess.id is null then
    begin
      insert into public.chatbot_sessions (clinic_id, lead_id, ticket_id, script_id, versao)
      values (p_clinic_id, p_lead_id, v_ticket, v_s.id, v_s.versao_publicada)
      returning * into v_sess;
      v_nova := true;
    exception when unique_violation then
      select * into v_sess from public.chatbot_sessions
       where ticket_id = v_ticket and status = 'aguardando' for update;
    end;
  end if;
  if v_sess.id is null then return jsonb_build_object('atendeu', false, 'motivo', 'sem_sessao'); end if;

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
    update public.chatbot_sessions set aguardando = null where id = v_sess.id;
    return jsonb_build_object('atendeu', false, 'motivo', 'passo_sumiu');
  end if;

  v_match := public.fn_chatbot_casar(v_sess.aguardando, p_texto, p_button_id);
  if v_match is not null then
    v_valor := v_match->>'id'; v_rotulo := v_match->>'rotulo';
  elsif coalesce(v_passo->>'tipo','') = 'texto'
        and coalesce(btrim(p_texto), '') <> ''
        and not public.fn_chatbot_parece_pergunta(p_texto) then
    v_valor := btrim(p_texto); v_rotulo := btrim(p_texto);
  end if;

  -- ── CORREÇÃO: bateu com opção de uma pergunta JÁ RESPONDIDA ──────────────────────────────────
  -- No WhatsApp o botão da mensagem antiga continua clicável, então quem não viu a pergunta nova
  -- toca no menu anterior. E quem mudou de ideia faz exatamente a mesma coisa. Nos dois casos
  -- "Não entendi" é a resposta errada.
  if v_valor is null then
    select e.item->>'slug', o.item into v_ant_slug, v_ant_op
      from jsonb_array_elements(v_def->'passos') e(item),
           jsonb_array_elements(coalesce(e.item->'opcoes','[]'::jsonb)) o(item)
     where e.item->>'slug' <> (v_passo->>'slug')
       and v_sess.respostas ? (e.item->>'slug')
       and (public.fn_chatbot_norm(o.item->>'rotulo') = public.fn_chatbot_norm(p_texto)
            or public.fn_chatbot_norm(o.item->>'id')  = public.fn_chatbot_norm(p_texto)
            or o.item->>'id' = coalesce(nullif(btrim(coalesce(p_button_id,'')),''), '~'))
     limit 1;

    if v_ant_op is not null then
      v_resp := coalesce(v_sess.respostas, '{}'::jsonb) || jsonb_build_object(
                  v_ant_slug, jsonb_build_object('valor', v_ant_op->>'id',
                                                 'rotulo', v_ant_op->>'rotulo', 'em', to_jsonb(now())));
      -- Derruba o que dependia da resposta trocada: quem escolheu Mangueirão depois de Alambrado
      -- não pode ficar com a malha que respondeu no caminho antigo.
      loop
        v_mudou := false;
        for v_k in select key from jsonb_each(v_resp) loop
          select e.item into v_pk from jsonb_array_elements(v_def->'passos') e(item)
           where e.item->>'slug' = v_k limit 1;
          if v_pk is not null and exists (
            select 1 from jsonb_array_elements(coalesce(v_pk->'so_se','[]'::jsonb)) c(item)
             where not exists (
               select 1 from jsonb_array_elements_text(coalesce(c.item->'valores','[]'::jsonb)) x(v)
                where x.v = coalesce(v_resp->(c.item->>'passo')->>'valor',''))
          ) then
            v_resp := v_resp - v_k; v_mudou := true;
          end if;
        end loop;
        exit when not v_mudou;
      end loop;

      update public.chatbot_sessions
         set respostas = v_resp, tentativas_passo = 0, aguardando = null, ultima_interacao_em = now()
       where id = v_sess.id;
      insert into public.chatbot_events (clinic_id, session_id, passo, tipo, detalhe)
      values (p_clinic_id, v_sess.id, v_ant_slug, 'casado',
              jsonb_build_object('valor', v_ant_op->>'id', 'correcao', true));
      perform public.fn_chatbot_ficha(v_ticket, v_def, v_resp);

      v_prox := public.fn_chatbot_passo_atual(v_def, v_resp);
      if v_prox is not null then
        perform public.fn_chatbot_apresentar(v_sess.id, p_clinic_id, p_lead_id, p_phone,
                                             v_prox, v_s.modo_envio, null, 0);
        return jsonb_build_object('atendeu', true, 'acao', 'corrigiu', 'passo', v_prox->>'slug');
      end if;
      v_valor := v_ant_op->>'id'; v_rotulo := v_ant_op->>'rotulo';  -- caiu no fim do roteiro
    end if;
  end if;

  if v_valor is null then
    v_idade := now() - coalesce((v_sess.aguardando->>'em')::timestamptz, now() - interval '1 hour');
    if v_idade < interval '12 seconds' then
      return jsonb_build_object('atendeu', true, 'acao', 'ignorou_rajada');
    end if;

    insert into public.chatbot_events (clinic_id, session_id, passo, tipo, detalhe)
    values (p_clinic_id, v_sess.id, v_passo->>'slug', 'nao_casou',
            jsonb_build_object('texto', left(coalesce(p_texto,''), 200),
                               'tentativa', v_sess.tentativas_passo + 1));

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

  v_resp := coalesce(v_sess.respostas, '{}'::jsonb) || jsonb_build_object(
              v_passo->>'slug',
              jsonb_build_object('valor', v_valor, 'rotulo', v_rotulo, 'em', to_jsonb(now())));

  update public.chatbot_sessions
     set respostas = v_resp, tentativas_passo = 0, aguardando = null, ultima_interacao_em = now()
   where id = v_sess.id;

  insert into public.chatbot_events (clinic_id, session_id, passo, tipo, detalhe)
  values (p_clinic_id, v_sess.id, v_passo->>'slug', 'casado',
          jsonb_build_object('valor', v_valor, 'clique', p_button_id is not null));

  perform public.fn_chatbot_ficha(v_ticket, v_def, v_resp);
  v_prox := public.fn_chatbot_passo_atual(v_def, v_resp);

  if v_prox is not null and coalesce(v_prox->>'tipo','') <> 'acao' then
    perform public.fn_chatbot_apresentar(v_sess.id, p_clinic_id, p_lead_id, p_phone,
                                         v_prox, v_s.modo_envio, null, 0);
    return jsonb_build_object('atendeu', true, 'acao', 'apresentou', 'passo', v_prox->>'slug');
  end if;

  v_msg := coalesce(nullif(v_prox->>'pergunta', ''), nullif(v_def->'fim'->>'mensagem', ''),
                    'Prontinho! Já passei suas informações para o nosso especialista, ele vai te responder por aqui o mais breve possível.');

  perform public.emit_message(
    p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
    p_kind => 'text', p_body => v_msg, p_lead_id => p_lead_id,
    p_dedup_key => 'chatbot:' || v_sess.id::text || ':fim',
    p_chat_payload => jsonb_build_object('sender','system','message', jsonb_build_object(
      'type','system','content', v_msg,'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb)));

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
  begin
    perform public.log_system_error('chatbot', 'turno_falhou',
      'O roteiro quebrou ao processar a mensagem e o contato pode ter ficado sem resposta',
      'critical', p_clinic_id,
      jsonb_build_object('telefone', p_phone, 'lead_id', p_lead_id, 'erro', sqlerrm), false);
  exception when others then null;
  end;
  return jsonb_build_object('atendeu', false, 'motivo', 'erro');
end $$;

revoke all on function public.fn_chatbot_apresentar(uuid, uuid, uuid, text, jsonb, text, text, int) from public, anon, authenticated;
revoke all on function public.fn_chatbot_turno(uuid, uuid, text, text, text) from public, anon, authenticated;
