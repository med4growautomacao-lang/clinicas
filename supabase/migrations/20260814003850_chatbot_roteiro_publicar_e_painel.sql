-- Publicação do Roteiro (valida e congela a versão) + painel "Onde o contato para".
--
-- A tela também valida, mas ela não pode ser o único portão: quem publica de verdade é o banco.

-- ── Publicar ───────────────────────────────────────────────────────────────────────────────────
-- Compila o rascunho em definição publicada e cria uma versão IMUTÁVEL.
--
-- O dono nunca escreve uma condição: ele marca, DENTRO da opção, quais perguntas aquela escolha
-- desbloqueia (`desbloqueia: ["malha","fio"]`). Aqui isso vira `so_se` no passo filho. Como a
-- marcação nasce sempre no passo PAI, é impossível por construção apontar para frente, e isso
-- substitui de graça a detecção de ciclo, nó órfão e passo inalcançável de um editor de grafo.
create or replace function public.fn_chatbot_publicar(p_script_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_s public.chatbot_scripts; v_rasc jsonb; v_passos jsonb; v_erros text[] := '{}';
  v_n int; v_i int; v_p jsonb; v_slug text; v_slugs text[] := '{}'; v_fichas text[] := '{}';
  v_opts jsonb; v_no int; v_ids text[]; v_alvo text; v_cond jsonb; v_out jsonb;
  v_nova_versao int; v_etapa record; v_campos int := 0;
begin
  select * into v_s from public.chatbot_scripts where id = p_script_id;
  if v_s.id is null then
    return jsonb_build_object('ok', false, 'erros', jsonb_build_array('Roteiro não encontrado.'));
  end if;
  perform public.assert_clinic_access(v_s.clinic_id);

  v_rasc  := coalesce(v_s.definicao_rascunho, '{}'::jsonb);
  v_passos := coalesce(v_rasc->'passos', '[]'::jsonb);
  v_n := jsonb_array_length(v_passos);

  if v_n = 0 then
    v_erros := v_erros || 'O roteiro não tem nenhuma pergunta.';
  end if;

  -- ── Destino: obrigatório e NUNCA etapa de desfecho ───────────────────────────────────────────
  -- Mover para Ganho faz a trigger de consistência gravar venda e faturamento sozinha: uma
  -- configuração errada aqui vira dinheiro inventado no painel, e ninguém veria até o fechamento.
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

    -- Guarda na ficha? Conta para o teto.
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
      -- Acima de 3 o envio vira LISTA automaticamente, e a lista do WhatsApp para em 10 itens.
      if v_no > 10 then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" tem ' || v_no
                   || ' opções, e o WhatsApp mostra no máximo 10. Junte opções ou divida a pergunta.');
      end if;
      select array_agg(o.item->>'id') into v_ids from jsonb_array_elements(v_opts) o(item);
      if v_ids is not null and array_length(v_ids,1) <> (select count(distinct x) from unnest(v_ids) x) then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" tem duas opções com a mesma identificação.');
      end if;
      if exists (select 1 from jsonb_array_elements(v_opts) o(item)
                  where coalesce(btrim(o.item->>'rotulo'),'') = '') then
        v_erros := v_erros || ('A pergunta "' || v_slug || '" tem opção sem texto.');
      end if;
      -- 20 caracteres é a convenção das APIs de WhatsApp para rótulo de botão. A uazapi não
      -- documenta limite, então isto AVISA no lugar de bloquear: bloquear pelo que não está
      -- escrito em lugar nenhum seria inventar regra.
      if exists (select 1 from jsonb_array_elements(v_opts) o(item)
                  where length(coalesce(o.item->>'rotulo','')) > 20) then
        v_erros := v_erros || ('AVISO: a pergunta "' || v_slug
                   || '" tem opção com mais de 20 caracteres, que pode ser cortada no celular do contato.');
      end if;

      -- O que cada opção desbloqueia tem que existir e vir DEPOIS.
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

  -- ⚠️ Teto de 10 campos: a ficha do ticket corta em 15 itens e o corte derruba o MAIS ANTIGO.
  -- Deixar folga é o que impede o campo que manda nas condições de sumir quando outra coisa
  -- também escrever na ficha.
  if v_campos > 10 then
    v_erros := v_erros || ('O roteiro guarda ' || v_campos || ' campos na ficha e o limite é 10, '
               || 'para sobrar espaço na ficha do vendedor.');
  end if;

  if exists (select 1 from unnest(v_erros) e where e not like 'AVISO:%') then
    return jsonb_build_object('ok', false, 'erros', to_jsonb(v_erros));
  end if;

  -- ── Compila `desbloqueia` (do pai) em `so_se` (no filho) ─────────────────────────────────────
  select jsonb_agg(
           case when v_cond_por_slug.cond is null then (p.item - 'so_se')
                else (p.item - 'so_se') || jsonb_build_object('so_se', v_cond_por_slug.cond) end
           order by p.ord)
    into v_passos
    from jsonb_array_elements(v_passos) with ordinality p(item, ord)
    left join lateral (
      select jsonb_agg(jsonb_build_object('passo', pai.slug, 'valores', pai.valores)) as cond
        from (
          select q.item->>'slug' as slug,
                 jsonb_agg(o.item->>'id') as valores
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

  update public.chatbot_scripts
     set versao_publicada = v_nova_versao, updated_at = now()
   where id = p_script_id;

  return jsonb_build_object('ok', true, 'versao', v_nova_versao,
                            'avisos', to_jsonb(array(select e from unnest(v_erros) e where e like 'AVISO:%')));
end $$;

-- ── Painel "Onde o contato para" ───────────────────────────────────────────────────────────────
-- Par wrapper + _impl, no padrão da casa: o guard mora no wrapper, a lógica no _impl, e o _impl
-- não tem EXECUTE para anon/authenticated.
create or replace function public.get_chatbot_funnel_impl(p_clinic_id uuid, p_from date, p_to date)
returns jsonb language sql stable security definer
set search_path to 'public'
as $$
  with base as (
    select e.passo, e.tipo, e.detalhe
      from public.chatbot_events e
     where e.clinic_id = p_clinic_id
       and (e.occurred_at at time zone 'America/Sao_Paulo')::date between p_from and p_to
  ), ordem as (
    select p.item->>'slug' as passo, p.ord,
           coalesce(p.item->>'rotulo_ficha', p.item->>'slug') as titulo
      from public.chatbot_scripts s
      join public.chatbot_versions v on v.script_id = s.id and v.versao = s.versao_publicada,
           jsonb_array_elements(v.definicao->'passos') with ordinality p(item, ord)
     where s.clinic_id = p_clinic_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'passo', o.passo, 'titulo', o.titulo, 'ordem', o.ord,
           'recebeu',     coalesce(b.apresentado, 0),
           'respondeu',   coalesce(b.casado, 0),
           'nao_entendeu',coalesce(b.nao_casou, 0),
           'clicou',      coalesce(b.clicou, 0),
           'digitou',     coalesce(b.casado, 0) - coalesce(b.clicou, 0),
           'virou_humano',coalesce(b.humano, 0)) order by o.ord), '[]'::jsonb)
    from ordem o
    left join (
      select passo,
             count(*) filter (where tipo = 'apresentado')      as apresentado,
             count(*) filter (where tipo = 'casado')           as casado,
             count(*) filter (where tipo = 'nao_casou')        as nao_casou,
             count(*) filter (where tipo = 'entregue_humano')  as humano,
             count(*) filter (where tipo = 'casado' and (detalhe->>'clique')::boolean) as clicou
        from base group by passo
    ) b on b.passo = o.passo
$$;

create or replace function public.get_chatbot_funnel(p_clinic_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return public.get_chatbot_funnel_impl(p_clinic_id, p_from, p_to);
end $$;

revoke all on function public.fn_chatbot_publicar(uuid)                     from public, anon, authenticated;
revoke all on function public.get_chatbot_funnel_impl(uuid, date, date)     from public, anon, authenticated;
revoke all on function public.get_chatbot_funnel(uuid, date, date)          from public, anon, authenticated;
grant execute on function public.fn_chatbot_publicar(uuid)                  to authenticated;
grant execute on function public.get_chatbot_funnel(uuid, date, date)       to authenticated;
