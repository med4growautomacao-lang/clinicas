-- Decisão do dono (13/08/2026): LISTA NÃO ACEITA FOTO.
--
-- A lista do WhatsApp não tem campo de imagem (só `type: button` tem `imageButton`), e a saída que
-- eu tinha feito, mandar a foto numa mensagem separada logo antes, é remendo: duas mensagens para
-- uma pergunta, e a foto solta sem o texto ao lado.
--
-- Agora a regra é uma frase: a foto vive DENTRO da mensagem, ou não existe.
--   até 3 opções  → vira botão  → a foto vai junto, no mesmo balão
--   mais de 3     → vira lista  → foto proibida, recusada na publicação
--   sem opção     → texto livre → a foto vai antes, e aí ela É a mensagem, não um enfeite
--
-- O plano B em texto numerado continua mandando a foto antes: ali ela é a degradação de uma
-- pergunta que TINHA foto no balão, e perder a imagem seria perder conteúdo.

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

  -- Foto em mensagem separada SÓ no caminho de texto. Quando a mensagem é menu, ou ela é botão (e
  -- a foto vai dentro, no imageButton) ou é lista (e foto é proibida na publicação).
  if v_midia is not null and (v_r->>'kind') <> 'menu' then
    perform public.emit_message(
      p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
      p_kind => 'media', p_media_url => v_midia, p_media_kind => 'image',
      p_lead_id => p_lead_id, p_dedup_key => v_dedup || ':foto');
  end if;

  if v_r->>'kind' = 'menu' then
    v_out := public.emit_message(
      p_clinic_id => p_clinic_id, p_to_addr => p_phone, p_producer => 'chatbot',
      -- ⚠️ A quebra de linha da frente mantém o cabeçalho VAZIO: a uazapi promove a primeira linha
      -- a header.title, e cabeçalho longo some no celular de parte dos contatos, em silêncio.
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

-- Publicação: recusa foto em pergunta que vira lista. A tela também impede, mas ela não pode ser
-- o único portão.
create or replace function public.fn_chatbot_publicar(p_script_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_s public.chatbot_scripts; v_rasc jsonb; v_passos jsonb; v_erros text[] := '{}';
  v_n int; v_i int; v_p jsonb; v_slug text; v_slugs text[] := '{}'; v_fichas text[] := '{}';
  v_opts jsonb; v_no int; v_ids text[]; v_alvo text; v_nova_versao int; v_etapa record; v_campos int := 0;
begin
  select * into v_s from public.chatbot_scripts where id = p_script_id;
  if v_s.id is null then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Roteiro não encontrado.'));
  end if;
  perform public.assert_clinic_access(v_s.clinic_id);

  v_rasc  := coalesce(v_s.definicao_rascunho, '{}'::jsonb);
  v_passos := coalesce(v_rasc->'passos', '[]'::jsonb);
  v_n := jsonb_array_length(v_passos);

  if v_n = 0 then v_erros := v_erros || 'O roteiro não tem nenhuma pergunta.'; end if;

  if v_s.etapa_destino_id is null then
    v_erros := v_erros || 'Falta escolher para onde o card vai quando o roteiro terminar.';
  else
    select fs.name, fs.slug into v_etapa from public.funnel_stages fs where fs.id = v_s.etapa_destino_id;
    if v_etapa.slug is null then
      v_erros := v_erros || 'A etapa de destino não existe mais. Escolha outra.';
    elsif v_etapa.slug in ('ganho','perdido','entregue','faltou_cancelou','agendado') then
      v_erros := v_erros || ('A etapa "' || v_etapa.name || '" não pode ser o destino do roteiro: '
                 || 'ela fecha o atendimento e lança venda ou perda sozinha. Escolha uma etapa de andamento.');
    end if;
  end if;

  for v_i in 0 .. greatest(v_n - 1, 0) loop
    exit when v_n = 0;
    v_p := v_passos->v_i;
    v_slug := nullif(btrim(coalesce(v_p->>'slug','')), '');

    if v_slug is null then
      v_erros := v_erros || ('A pergunta ' || (v_i + 1) || ' está sem identificação interna.');
      continue;
    end if;
    if v_slug = any(v_slugs) then
      v_erros := v_erros || ('Existem duas perguntas com a mesma identificação (' || v_slug || ').');
    end if;
    v_slugs := v_slugs || v_slug;

    if coalesce(btrim(v_p->>'pergunta'), '') = '' then
      v_erros := v_erros || ('A pergunta ' || (v_i + 1) || ' está sem texto: o contato receberia uma mensagem vazia.');
    end if;

    if coalesce(v_p->>'tipo','') not in ('opcoes','texto','acao') then
      v_erros := v_erros || ('A pergunta "' || v_slug || '" não tem um jeito de responder definido.');
    end if;

    if coalesce(v_p->>'tipo','') <> 'acao' then
      if coalesce(btrim(v_p->>'rotulo_ficha'), '') = '' then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" não guarda nada na ficha: a resposta do contato vai se perder.');
      else
        if lower(btrim(v_p->>'rotulo_ficha')) = any(v_fichas) then
          v_erros := v_erros || ('Duas perguntas guardam na ficha com o mesmo nome ("' || (v_p->>'rotulo_ficha') || '"), e uma apaga a outra.');
        end if;
        v_fichas := v_fichas || lower(btrim(v_p->>'rotulo_ficha'));
        v_campos := v_campos + 1;
      end if;
    end if;

    if coalesce(v_p->>'tipo','') = 'opcoes' then
      v_opts := coalesce(v_p->'opcoes', '[]'::jsonb);
      v_no := jsonb_array_length(v_opts);
      if v_no < 2 then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" precisa de pelo menos 2 opções.');
      end if;
      if v_no > 10 then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" tem ' || v_no
                   || ' opções, e o WhatsApp mostra no máximo 10. Junte opções ou divida a pergunta.');
      end if;

      -- ⚠️ Foto só existe dentro do balão, e só o botão tem esse campo.
      if v_no > 3 and coalesce(btrim(v_p->>'midia_url'), '') <> '' then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" tem ' || v_no
                   || ' opções, então ela é enviada como lista, e lista não mostra foto. '
                   || 'Tire a foto, ou deixe no máximo 3 opções para ela virar botão.');
      end if;

      select array_agg(o.item->>'id') into v_ids from jsonb_array_elements(v_opts) o(item);
      if v_ids is not null and array_length(v_ids,1) <> (select count(distinct x) from unnest(v_ids) x) then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" tem duas opções com a mesma identificação.');
      end if;
      if exists (select 1 from jsonb_array_elements(v_opts) o(item)
                  where coalesce(btrim(o.item->>'rotulo'),'') = '') then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" tem opção sem texto.');
      end if;
      if exists (select 1 from jsonb_array_elements(v_opts) o(item)
                  where length(coalesce(o.item->>'rotulo','')) > 20) then
        v_erros := v_erros || ('AVISO: a pergunta "' || v_slug
                   || '" tem opção com mais de 20 caracteres, que pode ser cortada no celular do contato.');
      end if;

      for v_alvo in
        select distinct d.v from jsonb_array_elements(v_opts) o(item),
             jsonb_array_elements_text(coalesce(o.item->'desbloqueia','[]'::jsonb)) d(v)
      loop
        if not exists (select 1 from jsonb_array_elements(v_passos) with ordinality q(item, ord)
                        where q.item->>'slug' = v_alvo and q.ord > v_i + 1) then
          v_erros := v_erros || ('A pergunta "' || v_slug || '" libera "' || v_alvo
                     || '", que não existe ou vem antes dela. Só dá para liberar pergunta que vem depois.');
        end if;
      end loop;
    end if;
  end loop;

  if v_campos > 10 then
    v_erros := v_erros || ('O roteiro guarda ' || v_campos || ' campos na ficha e o limite é 10, '
               || 'para sobrar espaço na ficha do vendedor.');
  end if;

  if exists (select 1 from unnest(v_erros) e where e not like 'AVISO:%') then
    return jsonb_build_object('ok', false, 'erros', to_jsonb(v_erros));
  end if;

  select jsonb_agg(
           case when v_cond_por_slug.cond is null then (p.item - 'so_se')
                else (p.item - 'so_se') || jsonb_build_object('so_se', v_cond_por_slug.cond) end
           order by p.ord)
    into v_passos
    from jsonb_array_elements(v_passos) with ordinality p(item, ord)
    left join lateral (
      select jsonb_agg(jsonb_build_object('passo', pai.slug, 'valores', pai.valores)) as cond
        from (
          select q.item->>'slug' as slug, jsonb_agg(o.item->>'id') as valores
            from jsonb_array_elements(coalesce(v_rasc->'passos','[]'::jsonb)) q(item),
                 jsonb_array_elements(coalesce(q.item->'opcoes','[]'::jsonb)) o(item)
           where exists (select 1 from jsonb_array_elements_text(coalesce(o.item->'desbloqueia','[]'::jsonb)) d(v)
                          where d.v = p.item->>'slug')
           group by q.item->>'slug'
        ) pai
    ) v_cond_por_slug on true;

  v_nova_versao := coalesce(v_s.versao_publicada, 0) + 1;

  insert into public.chatbot_versions (script_id, versao, definicao, publicado_por)
  values (p_script_id, v_nova_versao,
          jsonb_build_object('passos', coalesce(v_passos,'[]'::jsonb),
                             'fim', coalesce(v_rasc->'fim', '{}'::jsonb),
                             'humano', coalesce(v_rasc->'humano', '{}'::jsonb)),
          auth.uid());

  update public.chatbot_scripts set versao_publicada = v_nova_versao, updated_at = now()
   where id = p_script_id;

  return jsonb_build_object('ok', true, 'versao', v_nova_versao,
                            'avisos', to_jsonb(array(select e from unnest(v_erros) e where e like 'AVISO:%')));
end $$;

revoke all on function public.fn_chatbot_apresentar(uuid, uuid, uuid, text, jsonb, text, text, int) from public, anon, authenticated;
revoke all on function public.fn_chatbot_publicar(uuid) from public, anon, authenticated;
grant execute on function public.fn_chatbot_publicar(uuid) to authenticated;
