-- Memoria longa do agente ganha CONFIGURACAO PROPRIA.
--
-- Ate agora ela registrava consumo sob a chave do agente (`agent_ai_config`) e usava o modelo da
-- clinica. Duas consequencias ruins: no painel Consumo de IA ela sumia dentro do grupo do Agente
-- (impossivel responder "quanto custa a memoria?"), e ela pagava o preco do modelo caro para fazer
-- um trabalho de extracao estruturada, que qualquer modelo rapido faz.
--
-- Default = `gemini-3.1-flash-lite`, que JA tem preco cadastrado em `system_settings.llm_prices`
-- (0.10 entrada / 0.40 saida por 1M). ⚠️ CLAUDE.md §2: modelo sem preco entra com custo ZERO e o
-- total do painel encolhe em silencio. Ao trocar o modelo aqui, conferir o preco no mesmo ato.
-- Contra o Gemini Pro que ela usava, e ~30x mais barato na entrada.
--
-- `enabled` existe para poder desligar a memoria longa sem deploy, caso ela se mostre ruim: o
-- agente volta a depender so da janela de conversa, que e o comportamento de antes de 30/07.
insert into public.system_settings (id, value, description, updated_at)
values (
  'long_memory_config',
  jsonb_build_object(
    'enabled', true,
    'provider', 'gemini',
    'model', 'gemini-3.1-flash-lite',
    'temperature', 0.2
  )::text,
  'Memoria longa do Agente IA (_shared/agent/long-memory.ts): mantem a ficha de fatos do contato em leads.ai_long_memory. provider+model+temperature+enabled. Chaves no Vault.',
  now()
)
on conflict (id) do nothing;

create or replace function public.set_long_memory_config(p_config jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_prov  text := p_config->>'provider';
  v_model text := p_config->>'model';
  v_temp  numeric := nullif(p_config->>'temperature','')::numeric;
  v_on    boolean := coalesce((p_config->>'enabled')::boolean, true);
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_prov is null or v_prov not in ('gemini','anthropic','openai') then
    raise exception 'provider invalido: %', v_prov;
  end if;
  if coalesce(trim(v_model),'') = '' then
    raise exception 'model e obrigatorio';
  end if;
  if v_temp is not null and (v_temp < 0 or v_temp > 2) then
    raise exception 'temperature fora do intervalo [0,2]: %', v_temp;
  end if;

  insert into public.system_settings (id, value, description, updated_at)
  values (
    'long_memory_config',
    jsonb_build_object(
      'enabled', v_on,
      'provider', v_prov,
      'model', trim(v_model),
      'temperature', coalesce(v_temp, 0.2)
    )::text,
    'Memoria longa do Agente IA (_shared/agent/long-memory.ts): mantem a ficha de fatos do contato em leads.ai_long_memory. provider+model+temperature+enabled. Chaves no Vault.',
    now()
  )
  on conflict (id) do update set value = excluded.value, updated_at = now();

  return (select value::jsonb from public.system_settings where id = 'long_memory_config');
end;
$function$;

-- CLAUDE.md §1: `create function` reconcede ao PUBLIC; revogar de anon so nao fecha.
revoke all on function public.set_long_memory_config(jsonb) from public, anon, authenticated;
grant execute on function public.set_long_memory_config(jsonb) to authenticated;
