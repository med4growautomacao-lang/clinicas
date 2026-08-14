-- ⚠️ ASPA NO RÓTULO DO BOTÃO QUEBRA A MENSAGEM NO CELULAR, EM SILÊNCIO.
--
-- Provado no `provider_response` de um envio real (13/08/2026): a uazapi monta o campo
-- `buttonParamsJSON` do NativeFlowMessage CONCATENANDO texto, sem escapar. O rótulo `Malha 3"`
-- produziu:
--     {"id": "malha-3", "display_text": "Malha 3"", "disabled": false}
-- que é JSON inválido. O WhatsApp Web renderizou assim mesmo; o aplicativo do celular DESCARTOU a
-- mensagem. A uazapi devolveu 200 e o Emissor gravou status='sent': para o sistema, entregue.
--
-- O menu de entrada da mesma conversa, cujos rótulos não têm aspa, chegou nos dois.
--
-- Três caracteres são perigosos e nenhum deles é conteúdo de verdade:
--   "  quebra o JSON que a uazapi monta na mão
--   \  idem (escape solto)
--   |  é o separador do próprio campo `choices` ("rótulo|id|descrição")
--
-- Trocamos por equivalentes visuais em vez de apagar: `Malha 3"` vira `Malha 3”`, que o cliente lê
-- igual. Isto vale para rótulo, id e descrição, e roda no ponto ÚNICO onde as opções são montadas,
-- então a prévia do editor mostra exatamente o que sai.

create or replace function public.fn_chatbot_rotulo_seguro(p_texto text)
returns text language sql immutable parallel safe
set search_path to 'public'
as $$
  select translate(coalesce(p_texto, ''), '"\|', '”/-')
$$;

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
  -- O que a sessão guarda do que foi mostrado. Guarda o rótulo JÁ SEGURO, que é o que o contato
  -- vê e o que volta quando ele clica: casar contra o rótulo original faria o clique não bater.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.item->>'id',
           'rotulo', public.fn_chatbot_rotulo_seguro(o.item->>'rotulo'), 'pos', o.ord,
           'sinonimos', coalesce(o.item->'sinonimos', '[]'::jsonb)) order by o.ord), '[]'::jsonb)
    into v_apresentadas
    from jsonb_array_elements(v_opcoes) with ordinality o(item, ord);

  if v_tipo <> 'opcoes' or v_n = 0 then
    return jsonb_build_object('kind', 'text', 'body', v_texto, 'menu', null, 'opcoes', '[]'::jsonb);
  end if;

  if p_modo = 'menu' then
    -- Até 3 opções vira BOTÃO (único formato provado em produção); acima disso vira LISTA, que é o
    -- único tipo com descrição por item.
    if v_n <= 3 then
      v_menu_tipo := 'button';
      select jsonb_agg(public.fn_chatbot_rotulo_seguro(o.item->>'rotulo') || '|'
                       || public.fn_chatbot_rotulo_seguro(o.item->>'id') order by o.ord)
        into v_choices from jsonb_array_elements(v_opcoes) with ordinality o(item, ord);
    else
      v_menu_tipo := 'list';
      select jsonb_agg(public.fn_chatbot_rotulo_seguro(o.item->>'rotulo') || '|'
               || public.fn_chatbot_rotulo_seguro(o.item->>'id')
               || case when coalesce(o.item->>'descricao','') <> ''
                       then '|' || public.fn_chatbot_rotulo_seguro(o.item->>'descricao') else '' end
               order by o.ord)
        into v_choices from jsonb_array_elements(v_opcoes) with ordinality o(item, ord);
    end if;

    return jsonb_build_object(
      'kind', 'menu', 'body', v_texto, 'opcoes', v_apresentadas,
      'menu', jsonb_strip_nulls(jsonb_build_object(
        'type', v_menu_tipo,
        'text', v_texto,
        'choices', coalesce(v_choices, '[]'::jsonb),
        'footerText', nullif(p_passo->>'rodape', ''),
        'listButton',  case when v_menu_tipo = 'list'   then coalesce(nullif(p_passo->>'botao_lista',''), 'Ver opções') end,
        'imageButton', case when v_menu_tipo = 'button' then nullif(p_passo->>'midia_url', '') end)));
  end if;

  -- Plano B em texto numerado: aqui a aspa não quebra nada (não há JSON montado na mão), então o
  -- texto do CORPO segue como o dono escreveu.
  select string_agg(o.ord::text || ') ' || (o.item->>'rotulo')
           || case when coalesce(o.item->>'descricao','') <> ''
                   then '. ' || (o.item->>'descricao') else '' end, E'\n' order by o.ord)
    into v_linhas
    from jsonb_array_elements(v_opcoes) with ordinality o(item, ord);

  return jsonb_build_object(
    'kind', 'text', 'opcoes', v_apresentadas, 'menu', null,
    'body', v_texto || E'\n\n' || coalesce(v_linhas, '') || E'\n\nResponda com o número da opção.');
end $$;

revoke all on function public.fn_chatbot_rotulo_seguro(text) from public, anon, authenticated;
revoke all on function public.fn_chatbot_render(jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_chatbot_render(jsonb, text) to authenticated;
