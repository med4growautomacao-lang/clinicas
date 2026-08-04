-- Dois achados do 2o code-review (03/08), nas duas RPCs que a tela "Modelo do Agente" grava.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- (1) PROVIDER 'openai' MANDAVA A CHAVE DA OPENAI PARA O GOOGLE.
--
-- `_shared/llm.ts:283` despacha `cfg.provider === 'anthropic' ? anthropicTurn : geminiTurn`, ou
-- seja TUDO que nao e Anthropic vai para o Gemini. E `llm.ts:57` resolve a chave por provider.
-- Entao gravar provider='openai' faz o sistema buscar OPENAI_API_KEY e post-a-la na URL do Google
-- (a chave do Gemini viaja na query string). Resultado: segredo de um fornecedor entregue a outro,
-- alem de a memoria/agente simplesmente nunca funcionar.
--
-- A tela nunca ofereceu OpenAI (AgentAIPanel so lista Gemini e Anthropic), entao so chegava la quem
-- chamasse a RPC direto. Zero ocorrencias. Corrigido pela porta certa: a validacao para de aceitar.
-- ⚠️ Se um dia entrar suporte a OpenAI de verdade, o lugar de comecar e o despacho em llm.ts, NAO
-- esta lista.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- (2) `set_agent_ai_config` AINDA RECONSTRUIA O JSONB DO ZERO.
--
-- O gemeo `set_long_memory_config` virou merge parcial hoje de manha; este ficou para tras, no
-- botao ao lado da MESMA tela. CLAUDE.md §2: "Nunca reconstruir JSONB do zero... Sempre merge
-- parcial." Hoje `agent_ai_config` tem exatamente as 4 chaves que a funcao escreve e o unico
-- chamador reenvia as 4, entao o risco e ZERO agora; morde no dia em que alguem acrescentar uma
-- quinta chave (override por clinica, segundo fallback, cadencia) e ela sumir no primeiro "Salvar".
create or replace function public.set_agent_ai_config(p_config jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_padrao jsonb := jsonb_build_object(
    'provider', 'gemini', 'model', 'gemini-3.1-pro-preview-customtools',
    'temperature', 0.6, 'fallback', 'null'::jsonb);
  v_novo  jsonb;
  v_prov  text := p_config->>'provider';
  v_model text := p_config->>'model';
  v_temp  numeric := nullif(p_config->>'temperature','')::numeric;
  f_prov  text := p_config->'fallback'->>'provider';
  f_model text := p_config->'fallback'->>'model';
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_novo := coalesce(
    (select value::jsonb from public.system_settings where id = 'agent_ai_config'), v_padrao);
  v_novo := v_padrao || v_novo;  -- chave desconhecida sobrevive; chave do padrao que falte entra

  if p_config ? 'provider' then
    if v_prov is null or v_prov not in ('gemini','anthropic') then
      raise exception 'provider invalido: % (suportados: gemini, anthropic)', v_prov;
    end if;
    v_novo := jsonb_set(v_novo, '{provider}', to_jsonb(v_prov));
  end if;

  if p_config ? 'model' then
    if coalesce(trim(v_model),'') = '' then raise exception 'model e obrigatorio'; end if;
    v_novo := jsonb_set(v_novo, '{model}', to_jsonb(trim(v_model)));
  end if;

  if p_config ? 'temperature' then
    if v_temp is null or v_temp < 0 or v_temp > 2 then
      raise exception 'temperature fora do intervalo [0,2]: %', p_config->>'temperature';
    end if;
    v_novo := jsonb_set(v_novo, '{temperature}', to_jsonb(v_temp));
  end if;

  -- fallback ausente PRESERVA o atual; presente e invalido/nulo LIMPA (a tela manda null de proposito)
  if p_config ? 'fallback' then
    if f_prov is not null and f_prov in ('gemini','anthropic') and coalesce(trim(f_model),'') <> '' then
      v_novo := jsonb_set(v_novo, '{fallback}', jsonb_build_object('provider', f_prov, 'model', trim(f_model)));
    else
      v_novo := jsonb_set(v_novo, '{fallback}', 'null'::jsonb);
    end if;
  end if;

  insert into public.system_settings (id, value, description, updated_at)
  values ('agent_ai_config', v_novo::text,
    'Modelo do Agente IA (edge ai-agent): provider+model+temperature+fallback. Chaves no Vault.', now())
  on conflict (id) do update set value = excluded.value, updated_at = now();

  return v_novo;
end;
$function$;

-- Mesma poda de provider na memoria longa (o merge dela ja foi feito em 20260803204628).
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

  v_novo := coalesce(
    (select value::jsonb from public.system_settings where id = 'long_memory_config'), v_padrao);
  v_novo := v_padrao || v_novo;

  if p_config ? 'provider' then
    if v_prov is null or v_prov not in ('gemini','anthropic') then
      raise exception 'provider invalido: % (suportados: gemini, anthropic)', v_prov;
    end if;
    v_novo := jsonb_set(v_novo, '{provider}', to_jsonb(v_prov));
  end if;

  if p_config ? 'model' then
    if coalesce(trim(v_model),'') = '' then raise exception 'model e obrigatorio'; end if;
    v_novo := jsonb_set(v_novo, '{model}', to_jsonb(trim(v_model)));
  end if;

  if p_config ? 'temperature' then
    if v_temp is null or v_temp < 0 or v_temp > 2 then
      raise exception 'temperature fora do intervalo [0,2]: %', p_config->>'temperature';
    end if;
    v_novo := jsonb_set(v_novo, '{temperature}', to_jsonb(v_temp));
  end if;

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

-- CLAUDE.md §1: `create function` reconcede ao PUBLIC; revogar de anon so nao fecha.
revoke all on function public.set_agent_ai_config(jsonb)   from public, anon, authenticated;
revoke all on function public.set_long_memory_config(jsonb) from public, anon, authenticated;
grant execute on function public.set_agent_ai_config(jsonb)   to authenticated;
grant execute on function public.set_long_memory_config(jsonb) to authenticated;
