-- Motor do Roteiro, parte 1: as funções PURAS (sem efeito colateral).
-- Elas são usadas pelo motor em produção E pela pré-visualização do editor. Uma implementação só,
-- então a prévia da tela não pode divergir do que o cliente recebe.

-- ── Normalizador ───────────────────────────────────────────────────────────────────────────────
-- A extensão `unaccent` NÃO está instalada neste projeto (conferido em pg_extension), por isso o
-- translate na mão. Minúsculo, sem acento, só letra e número, espaço colapsado.
create or replace function public.fn_chatbot_norm(p_texto text)
returns text language sql immutable parallel safe
set search_path to 'public'
as $$
  select nullif(btrim(regexp_replace(
           translate(lower(coalesce(p_texto, '')),
             'áàâãäéèêëíìîïóòôõöúùûüçñ',
             'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- ── Qual é a pergunta da vez ───────────────────────────────────────────────────────────────────
-- A primeira do roteiro que ainda não foi respondida E cuja condição vale. A ordem do array É a
-- topologia: não existe seta porque a seta é sempre "a próxima que se aplica".
--
-- ⚠️ `so_se` só pode olhar para TRÁS. Isso é garantido na publicação (a marcação nasce na opção do
-- passo pai), e é o que substitui de graça a detecção de ciclo, nó órfão e passo inalcançável que
-- um editor de grafo obrigaria a escrever.
create or replace function public.fn_chatbot_passo_atual(p_definicao jsonb, p_respostas jsonb)
returns jsonb language plpgsql immutable parallel safe
set search_path to 'public'
as $$
declare
  v_passo jsonb; v_cond jsonb; v_ok boolean; v_slug text;
  v_resp jsonb := coalesce(p_respostas, '{}'::jsonb);
begin
  for v_passo in
    select value from jsonb_array_elements(coalesce(p_definicao->'passos', '[]'::jsonb))
  loop
    v_slug := v_passo->>'slug';
    if v_slug is null or v_resp ? v_slug then continue; end if;

    v_ok := true;
    for v_cond in
      select value from jsonb_array_elements(coalesce(v_passo->'so_se', '[]'::jsonb))
    loop
      if not exists (
        select 1 from jsonb_array_elements_text(coalesce(v_cond->'valores', '[]'::jsonb)) t(v)
         where t.v = coalesce(v_resp->(v_cond->>'passo')->>'valor', '')
      ) then
        v_ok := false; exit;
      end if;
    end loop;

    if v_ok then return v_passo; end if;
  end loop;
  return null;  -- acabou o roteiro
end $$;

-- ── Como a pergunta sai no WhatsApp ────────────────────────────────────────────────────────────
-- Devolve {kind, body, menu, opcoes}. `opcoes` é o que foi REALMENTE apresentado, e é gravado na
-- sessão: é contra ele que "2" é interpretado depois.
create or replace function public.fn_chatbot_render(p_passo jsonb, p_modo text default 'menu')
returns jsonb language plpgsql immutable parallel safe
set search_path to 'public'
as $$
declare
  v_tipo    text  := coalesce(p_passo->>'tipo', 'texto');
  v_opcoes  jsonb := coalesce(p_passo->'opcoes', '[]'::jsonb);
  v_n       int   := jsonb_array_length(coalesce(p_passo->'opcoes', '[]'::jsonb));
  v_texto   text  := coalesce(p_passo->>'pergunta', '');
  v_choices jsonb; v_menu_tipo text; v_linhas text; v_apresentadas jsonb;
begin
  -- O que a sessão guarda do que foi mostrado (rótulo + posição, para casar número e texto).
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.item->>'id', 'rotulo', o.item->>'rotulo', 'pos', o.ord,
           'sinonimos', coalesce(o.item->'sinonimos', '[]'::jsonb)) order by o.ord), '[]'::jsonb)
    into v_apresentadas
    from jsonb_array_elements(v_opcoes) with ordinality o(item, ord);

  -- Passo sem opção (texto livre) sempre sai como texto puro.
  if v_tipo <> 'opcoes' or v_n = 0 then
    return jsonb_build_object('kind', 'text', 'body', v_texto, 'menu', null, 'opcoes', '[]'::jsonb);
  end if;

  if p_modo = 'menu' then
    -- ⚠️ Até 3 opções vira BOTÃO, que é o ÚNICO formato provado em produção (11 menus enviados,
    -- todos type=button com 3 opções, 100% entregues). Acima de 3 vira LISTA, que é o único tipo
    -- com descrição por item. Enquete e carrossel ficaram de fora de propósito.
    if v_n <= 3 then
      v_menu_tipo := 'button';
      select jsonb_agg((o.item->>'rotulo') || '|' || (o.item->>'id') order by o.ord)
        into v_choices from jsonb_array_elements(v_opcoes) with ordinality o(item, ord);
    else
      v_menu_tipo := 'list';
      select jsonb_agg((o.item->>'rotulo') || '|' || (o.item->>'id')
               || case when coalesce(o.item->>'descricao','') <> ''
                       then '|' || (o.item->>'descricao') else '' end order by o.ord)
        into v_choices from jsonb_array_elements(v_opcoes) with ordinality o(item, ord);
    end if;

    return jsonb_build_object(
      'kind', 'menu', 'body', v_texto, 'opcoes', v_apresentadas,
      'menu', jsonb_strip_nulls(jsonb_build_object(
        'type', v_menu_tipo,
        'text', v_texto,
        'choices', coalesce(v_choices, '[]'::jsonb),
        'footerText', nullif(p_passo->>'rodape', ''),
        -- imageButton só existe para type=button na doc da uazapi. Em lista, a foto vai como
        -- mensagem de mídia separada, logo antes (a fila é ordenada por conversa).
        'listButton',  case when v_menu_tipo = 'list'   then coalesce(nullif(p_passo->>'botao_lista',''), 'Ver opções') end,
        'imageButton', case when v_menu_tipo = 'button' then nullif(p_passo->>'midia_url', '') end)));
  end if;

  -- ── Plano B: texto numerado ──────────────────────────────────────────────────────────────────
  -- Existe desde o primeiro dia porque a própria uazapi documenta que botão e lista podem ser
  -- descontinuados a qualquer momento, sem aviso. O matcher aceita o número, então este caminho
  -- funciona sem nenhuma outra mudança.
  select string_agg(o.ord::text || ') ' || (o.item->>'rotulo')
           || case when coalesce(o.item->>'descricao','') <> ''
                   then '. ' || (o.item->>'descricao') else '' end, E'\n' order by o.ord)
    into v_linhas
    from jsonb_array_elements(v_opcoes) with ordinality o(item, ord);

  return jsonb_build_object(
    'kind', 'text', 'opcoes', v_apresentadas, 'menu', null,
    'body', v_texto || E'\n\n' || coalesce(v_linhas, '') || E'\n\nResponda com o número da opção.');
end $$;

-- ── O que o contato respondeu casa com qual opção ──────────────────────────────────────────────
-- Cascata deliberada, da evidência mais forte para a mais fraca. Devolve a opção ou NULL.
--
-- ⚠️ O passo 2 não é redundância: `wa-inbound` grava `botaoRotulo || botaoId`, ou seja, quando a
-- uazapi não manda o campo `vote` chega o ID e não o rótulo. Por isso o id da opção é o próprio
-- rótulo normalizado ("tela-alambrado"), e por isso ele também é testado como texto.
create or replace function public.fn_chatbot_casar(p_aguardando jsonb, p_texto text, p_button_id text)
returns jsonb language plpgsql immutable parallel safe
set search_path to 'public'
as $$
declare
  v_ops jsonb := coalesce(p_aguardando->'opcoes', '[]'::jsonb);
  v_txt text  := public.fn_chatbot_norm(p_texto);
  v_bid text  := nullif(btrim(coalesce(p_button_id, '')), '');
  v_hit jsonb; v_cnt int;
begin
  if jsonb_array_length(v_ops) = 0 then return null; end if;

  -- 1) id do clique
  if v_bid is not null then
    select o.item into v_hit from jsonb_array_elements(v_ops) o(item)
     where o.item->>'id' = v_bid limit 1;
    if v_hit is not null then return v_hit; end if;
  end if;

  if v_txt is null then return null; end if;

  -- 2) o id chegando como texto
  select o.item into v_hit from jsonb_array_elements(v_ops) o(item)
   where public.fn_chatbot_norm(o.item->>'id') = v_txt limit 1;
  if v_hit is not null then return v_hit; end if;

  -- 3) rótulo exato
  select o.item into v_hit from jsonb_array_elements(v_ops) o(item)
   where public.fn_chatbot_norm(o.item->>'rotulo') = v_txt limit 1;
  if v_hit is not null then return v_hit; end if;

  -- 4) número da posição: é o que faz o plano B em texto funcionar sem código novo
  if v_txt ~ '^[0-9]{1,2}$' then
    select o.item into v_hit from jsonb_array_elements(v_ops) o(item)
     where (o.item->>'pos')::int = v_txt::int limit 1;
    if v_hit is not null then return v_hit; end if;
  end if;

  -- 5) sinônimo cadastrado pela empresa ("3 pol", "3 polegadas")
  select o.item into v_hit from jsonb_array_elements(v_ops) o(item)
   where exists (select 1 from jsonb_array_elements_text(coalesce(o.item->'sinonimos','[]'::jsonb)) s(v)
                  where public.fn_chatbot_norm(s.v) = v_txt) limit 1;
  if v_hit is not null then return v_hit; end if;

  -- 6) prefixo ÚNICO, e só a partir de 3 caracteres: com menos, "ma" casaria com Malha e
  -- Mangueirão ao mesmo tempo, e casar errado é pior que não casar.
  if length(v_txt) >= 3 then
    select count(*) into v_cnt from jsonb_array_elements(v_ops) o(item)
     where public.fn_chatbot_norm(o.item->>'rotulo') like v_txt || '%';
    if v_cnt = 1 then
      select o.item into v_hit from jsonb_array_elements(v_ops) o(item)
       where public.fn_chatbot_norm(o.item->>'rotulo') like v_txt || '%' limit 1;
      return v_hit;
    end if;
  end if;

  return null;
end $$;

-- ── Isto parece pergunta, não resposta? ────────────────────────────────────────────────────────
-- Sem IA no caminho, passo de texto livre casaria com QUALQUER coisa: "Vocês entregam em Passos?"
-- digitado no passo da Cidade viraria Cidade = "Vocês entregam em Passos?", e o vendedor receberia
-- uma ficha completa, confiante e errada. Heurística determinística, de propósito conservadora:
-- na dúvida, trata como RESPOSTA (falso negativo custa um campo torto; falso positivo trava o
-- roteiro de quem respondeu certo).
create or replace function public.fn_chatbot_parece_pergunta(p_texto text)
returns boolean language sql immutable parallel safe
set search_path to 'public'
as $$
  select case
    when coalesce(btrim(p_texto), '') = '' then false
    when btrim(p_texto) like '%?' then true
    -- Abertura interrogativa clássica, no começo da frase.
    when public.fn_chatbot_norm(p_texto) ~
         '^(qual|quais|quanto|quanta|quantos|quantas|quando|onde|como|porque|por que|voce|voces|tem|teria|da pra|da para|pode|poderia|sera|e possivel|preciso saber|queria saber|gostaria de saber)\M'
      then true
    -- Texto longo demais para ser uma medida, uma cidade ou um nome.
    when length(btrim(p_texto)) > 120 then true
    else false
  end
$$;

revoke all on function public.fn_chatbot_norm(text)                    from public, anon, authenticated;
revoke all on function public.fn_chatbot_passo_atual(jsonb, jsonb)     from public, anon, authenticated;
revoke all on function public.fn_chatbot_render(jsonb, text)           from public, anon, authenticated;
revoke all on function public.fn_chatbot_casar(jsonb, text, text)      from public, anon, authenticated;
revoke all on function public.fn_chatbot_parece_pergunta(text)         from public, anon, authenticated;

-- A tela do editor precisa da prévia e do simulador, e os dois chamam as puras. São funções sem
-- efeito colateral e sem acesso a dado de clínica nenhuma (recebem tudo por parâmetro).
grant execute on function public.fn_chatbot_passo_atual(jsonb, jsonb) to authenticated;
grant execute on function public.fn_chatbot_render(jsonb, text)       to authenticated;
grant execute on function public.fn_chatbot_casar(jsonb, text, text)  to authenticated;
