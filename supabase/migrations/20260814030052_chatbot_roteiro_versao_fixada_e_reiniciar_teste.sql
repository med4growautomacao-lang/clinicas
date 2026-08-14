-- 1) A VERSÃO FIXADA NA SESSÃO NÃO ESTAVA SENDO RESPEITADA.
--    `chatbot_sessions.versao` era gravado e ignorado: o motor sempre lia
--    `chatbot_scripts.versao_publicada`. Ou seja, publicar uma edição trocava o roteiro DEBAIXO de
--    quem estava no meio da conversa. Com mudança de texto passa despercebido; apagando uma opção,
--    `aguardando.opcoes` passa a apontar para o que não existe mais e o clique do contato deixa de
--    bater. Agora a sessão manda, e só sessão NOVA nasce na versão publicada.
--
-- 2) REINICIAR A CONVERSA DE TESTE sem depender de SQL na mão. Apaga a sessão aberta dos números
--    de teste DO ROTEIRO, e só deles.

create or replace function public.fn_chatbot_reiniciar_teste(p_script_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_s public.chatbot_scripts; v_n int;
begin
  select * into v_s from public.chatbot_scripts where id = p_script_id;
  if v_s.id is null then
    return jsonb_build_object('ok', false, 'erro', 'Roteiro não encontrado.');
  end if;
  perform public.assert_clinic_access(v_s.clinic_id);

  -- ⚠️ Sem número de teste cadastrado, isto apagaria a conversa de CLIENTE REAL no meio do
  -- atendimento. Recusa é a resposta certa.
  if coalesce(array_length(v_s.test_numbers, 1), 0) = 0 then
    return jsonb_build_object('ok', false,
      'erro', 'Cadastre ao menos um número de teste antes de reiniciar: sem isso o reinício atingiria conversa de cliente real.');
  end if;

  with alvo as (
    select s.id from public.chatbot_sessions s
      join public.leads l on l.id = s.lead_id
     where s.script_id = p_script_id
       and exists (select 1 from unnest(v_s.test_numbers) t
                    where public.normalize_br_phone(t) = public.normalize_br_phone(l.phone))
  )
  delete from public.chatbot_sessions d using alvo where d.id = alvo.id;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'reiniciadas', v_n);
end $$;

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
  v_abertura text; v_atraso int := 0;
begin
  v_script_id := public.fn_chatbot_script_ativo(p_clinic_id, p_phone);
  if v_script_id is null then return jsonb_build_object('atendeu', false, 'motivo', 'sem_roteiro'); end if;

  select * into v_s from public.chatbot_scripts where id = v_script_id;

  select id into v_ticket from public.tickets
   where lead_id = p_lead_id and status = 'open' order by created_at desc limit 1;
  if v_ticket is null then return jsonb_build_object('atendeu', false, 'motivo', 'sem_ticket'); end if;

  -- ⚠️ QUALQUER sessão do ticket, não só a aberta: sessão encerrada ignorada fazia uma nova nascer
  -- na mensagem seguinte, e o robô voltava a perguntar por cima do vendedor que ele mesmo chamou.
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

  -- ⚠️ A VERSÃO É A DA SESSÃO, não a publicada. É isto que deixa o dono editar e publicar com
  -- conversa no ar sem trocar o roteiro debaixo de quem está no meio dele.
  select definicao into v_def from public.chatbot_versions
   where script_id = v_s.id and versao = coalesce(v_sess.versao, v_s.versao_publicada);

  if v_def is null then
    perform public.log_system_error('chatbot', 'roteiro_sem_versao',
      'O roteiro está ligado mas a versão da conversa não existe: o contato ficou sem resposta',
      'critical', p_clinic_id,
      jsonb_build_object('script_id', v_s.id, 'versao', v_sess.versao, 'telefone', p_phone), false);
    return jsonb_build_object('atendeu', false, 'motivo', 'sem_versao');
  end if;

  if v_nova or v_sess.aguardando is null then
    v_prox := public.fn_chatbot_passo_atual(v_def, v_sess.respostas);
    if v_prox is null then return jsonb_build_object('atendeu', false, 'motivo', 'roteiro_vazio'); end if;

    -- Apresentação da empresa, uma vez, antes da primeira pergunta.
    v_abertura := nullif(btrim(coalesce(v_s.mensagem_abertura, '')), '');
    if v_nova and v_abertura is not null then
      perform public.emit_message(
        p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
        p_kind => 'text', p_body => v_abertura, p_lead_id => p_lead_id,
        p_dedup_key => 'chatbot:' || v_sess.id::text || ':abertura',
        p_chat_payload => jsonb_build_object('sender','system','message', jsonb_build_object(
          'type','system','content', v_abertura,
          'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb)));
      v_atraso := 1500;
      insert into public.chatbot_events (clinic_id, session_id, passo, tipo)
      values (p_clinic_id, v_sess.id, 'abertura', 'apresentado');
    end if;

    perform public.fn_chatbot_apresentar(v_sess.id, p_clinic_id, p_lead_id, p_phone,
                                         v_prox, v_s.modo_envio, null, 0, v_atraso);
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

  -- CORREÇÃO: bateu com opção de uma pergunta JÁ RESPONDIDA (clique em botão antigo ou mudança
  -- de ideia). Nos dois casos "Não entendi" é a resposta errada.
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
                                             v_prox, v_s.modo_envio, null, 0, 0);
        return jsonb_build_object('atendeu', true, 'acao', 'corrigiu', 'passo', v_prox->>'slug');
      end if;
      v_valor := v_ant_op->>'id'; v_rotulo := v_ant_op->>'rotulo';
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
              v_s.modo_envio, 'Não entendi. ', v_sess.tentativas_passo + 1, 0);
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
                                         v_prox, v_s.modo_envio, null, 0, 0);
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

  -- ⚠️ Etapa de desfecho é PROIBIDA como destino, validado na publicação: mover para 'ganho' faz a
  -- trigger de consistência gravar venda e faturamento sozinha.
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

revoke all on function public.fn_chatbot_turno(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_chatbot_reiniciar_teste(uuid) from public, anon, authenticated;
grant execute on function public.fn_chatbot_reiniciar_teste(uuid) to authenticated;
