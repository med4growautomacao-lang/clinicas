-- Tres achados do code-review de 03/08 sobre o lote da memoria longa (30/07).

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) SECURITY_INVOKER de volta na view da memoria.
--
-- A migration 20260730171254 (outra sessao) ligou `security_invoker = on` nesta view, e a
-- 20260730195844 (minha, para expor created_at) apagou sem querer: `create or replace view` SEM
-- clausula WITH zera `reloptions`. Confirmado no banco: reloptions estava NULL.
--
-- Nao houve exposicao, porque `anon` e `authenticated` continuam sem SELECT (o revoke daquela
-- migration sobreviveu, e esta reafirmado abaixo). Mas sem `security_invoker` a view roda com os
-- privilegios do DONO e NAO aplica a RLS de chat_messages: no dia em que alguem conceder SELECT,
-- ela devolveria conversa de todas as clinicas juntas.
--
-- ⚠️ Ao mexer nesta view de novo, reaplique esta linha no MESMO passo.
alter view public.vw_n8n_chat_memory set (security_invoker = on);
revoke all on table public.vw_n8n_chat_memory from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) A limpeza do prompt cobria SO o "Agendamento V3".
--
-- "Agendamento V1", "V2" e "Teste" continuavam com a tool MEMORIA_LONGA (sub-workflow do n8n que
-- nao existe no agente nativo, listada como a PRIMEIRA ferramenta) e com as expressoes
-- `{{ $('Start')... }}`, que chegam ao modelo como texto literal. Nenhuma clinica aponta para eles
-- hoje, MAS o template e trocado num menu da aba Comercial que recepcao/vendedora/gestor usam, sem
-- confirmacao, e 30 das 34 clinicas estao na opcao "Padrao": a proxima que ligar o agente escolhe
-- de uma lista onde 3 das 4 opcoes estao quebradas.
--
-- Agora o UPDATE e por CONTEUDO, nao por id fixo: qualquer template que ainda carregue o texto
-- morto e corrigido, inclusive os que forem criados por copia depois.
update public.prompt_templates
set content = replace(
  replace(
    replace(
      replace(content,
        E'  MEMORIA_LONGA:\n    uso: |\n      Esteja atento para usar a MEMORIA_LONGA para armazenar informações importantes\n      do lead durante toda a conversa.\n\n',
        ''),
      E'  - passo: "contínuo"\n    acao: "MEMORIA_LONGA: armazene informações importantes do lead ao longo de toda a conversa."\n',
      ''),
    E'variaveis:\n  telefone_lead: "{{ $(''Start'').item.json.lead_phone }}"\n\nferramentas:',
    E'memoria_do_contato: |\n  Antes desta conversa você pode receber um bloco "## Memória do Contato" e/ou\n  "## Resumo do Contato" com o que esta pessoa JÁ informou antes: nome, idade, forma de\n  atendimento, queixa, diagnóstico, medicação, objeções e preferência de horário.\n  O sistema mantém esses blocos sozinho. Você NÃO salva nada, NÃO existe ferramenta de\n  memória, e você NUNCA menciona esses blocos ao paciente.\n  Como usar:\n  - O que está lá já foi dito pela pessoa: NÃO repergunte.\n  - Bloco ausente ou vazio = primeiro contato: colete normalmente.\n  - Se o paciente disser algo DIFERENTE do que está no bloco, vale o que ele diz AGORA.\n  - Falta um dado? Pergunte só o que falta, uma coisa de cada vez.\n\nferramentas:'),
  E'"{{ $(''Start'').item.json.lead_phone }}"',
  '"(preenchido pelo sistema — não escreva nada aqui)"')
where content like '%MEMORIA_LONGA%' or content like '%$(''Start'')%';

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) `set_long_memory_config` reconstruia o jsonb do zero.
--
-- CLAUDE.md §2: "Nunca reconstruir JSONB do zero... Sempre merge parcial." A versao anterior fazia
-- jsonb_build_object com as 4 chaves que ela conhece e `value = excluded.value`, entao qualquer
-- chave acrescentada depois (override por clinica, fallback, cadencia) seria apagada no primeiro
-- clique em "Salvar memória", sem erro e sem rastro. E o mesmo padrao que ja apagou
-- `breakdown_enabled` na config de investimento.
--
-- Agora: le o que existe, valida SO o que veio, e sobrescreve SO as chaves enviadas.
create or replace function public.set_long_memory_config(p_config jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_padrao jsonb := jsonb_build_object(
    'enabled', true, 'provider', 'gemini', 'model', 'gemini-3.1-flash-lite', 'temperature', 0.2);
  v_novo jsonb;
  v_prov text := p_config->>'provider';
  v_model text := p_config->>'model';
  v_temp numeric := nullif(p_config->>'temperature','')::numeric;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Base = o que ja esta gravado; so cai no padrao se a linha nao existir.
  v_novo := coalesce(
    (select value::jsonb from public.system_settings where id = 'long_memory_config'),
    v_padrao);
  -- Chave que exista no banco mas nao no padrao continua de pe; chave do padrao que falte entra.
  v_novo := v_padrao || v_novo;

  if p_config ? 'provider' then
    if v_prov is null or v_prov not in ('gemini','anthropic','openai') then
      raise exception 'provider invalido: %', v_prov;
    end if;
    v_novo := jsonb_set(v_novo, '{provider}', to_jsonb(v_prov));
  end if;

  if p_config ? 'model' then
    if coalesce(trim(v_model),'') = '' then
      raise exception 'model e obrigatorio';
    end if;
    v_novo := jsonb_set(v_novo, '{model}', to_jsonb(trim(v_model)));
  end if;

  if p_config ? 'temperature' then
    if v_temp is null or v_temp < 0 or v_temp > 2 then
      raise exception 'temperature fora do intervalo [0,2]: %', p_config->>'temperature';
    end if;
    v_novo := jsonb_set(v_novo, '{temperature}', to_jsonb(v_temp));
  end if;

  -- ⚠️ `enabled` ausente PRESERVA o valor atual, nunca assume true: era assim que uma gravacao
  -- parcial religava a memoria de todo mundo sem ninguem pedir.
  if p_config ? 'enabled' then
    v_novo := jsonb_set(v_novo, '{enabled}', to_jsonb(coalesce((p_config->>'enabled')::boolean, true)));
  end if;

  insert into public.system_settings (id, value, description, updated_at)
  values ('long_memory_config', v_novo::text,
    'Memoria longa do Agente IA (_shared/agent/long-memory.ts): mantem a ficha de fatos do contato em leads.ai_long_memory. provider+model+temperature+enabled. Chaves no Vault.',
    now())
  on conflict (id) do update set value = excluded.value, updated_at = now();

  return v_novo;
end;
$function$;

revoke all on function public.set_long_memory_config(jsonb) from public, anon, authenticated;
grant execute on function public.set_long_memory_config(jsonb) to authenticated;
