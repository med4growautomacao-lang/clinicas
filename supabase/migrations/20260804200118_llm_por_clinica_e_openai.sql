-- Modelo do agente POR CLÍNICA, com o system_settings como padrão.
--
-- Por que tabela própria e não coluna em ai_config: `ai_config` tem a policy `ai_config_all`
-- FOR ALL com `my_clinic_ids()`, ou seja, o admin da própria clínica edita a linha dele. Modelo de
-- LLM é decisão de CUSTO do dono, não do cliente: coluna ali deixaria qualquer clínica trocar o
-- próprio modelo (e a conta é da casa). Aqui a escrita é Super Admin e ponto.
create table if not exists public.clinic_llm_config (
  clinic_id  uuid primary key references public.clinics(id) on delete cascade,
  provider   text not null,
  model      text not null,
  nota       text,
  updated_at timestamptz not null default now(),
  constraint clinic_llm_config_provider_chk check (provider in ('gemini','anthropic','openai'))
);

alter table public.clinic_llm_config enable row level security;

-- Leitura: a clínica pode ver o que roda nela; escrita, só Super Admin.
drop policy if exists clinic_llm_config_read on public.clinic_llm_config;
create policy clinic_llm_config_read on public.clinic_llm_config for select
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

drop policy if exists clinic_llm_config_write on public.clinic_llm_config;
create policy clinic_llm_config_write on public.clinic_llm_config for all
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- Grava ou APAGA o override. p_provider nulo/vazio = a clínica volta ao padrão do sistema, que é
-- como se desliga sem precisar de uma segunda tela.
create or replace function public.set_clinic_llm_config(
  p_clinic_id uuid, p_provider text default null, p_model text default null, p_nota text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_prov text := nullif(trim(coalesce(p_provider,'')),''); v_model text := nullif(trim(coalesce(p_model,'')),'');
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_clinic_id is null then raise exception 'clinic_id e obrigatorio'; end if;

  if v_prov is null then
    delete from public.clinic_llm_config where clinic_id = p_clinic_id;
    return jsonb_build_object('clinic_id', p_clinic_id, 'override', null);
  end if;

  if v_prov not in ('gemini','anthropic','openai') then
    raise exception 'provider invalido: % (suportados: gemini, anthropic, openai)', v_prov;
  end if;
  if v_model is null then raise exception 'model e obrigatorio quando ha provider'; end if;

  insert into public.clinic_llm_config (clinic_id, provider, model, nota, updated_at)
  values (p_clinic_id, v_prov, v_model, p_nota, now())
  on conflict (clinic_id) do update
    set provider = excluded.provider, model = excluded.model,
        nota = excluded.nota, updated_at = now();

  return jsonb_build_object('clinic_id', p_clinic_id, 'provider', v_prov, 'model', v_model);
end $$;

revoke all on function public.set_clinic_llm_config(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_clinic_llm_config(uuid, text, text, text) to authenticated;

-- ⚠️ A RPC do modelo GLOBAL recusava 'openai' com exceção, então a tela podia oferecer OpenAI e o
-- banco derrubava o save. Agora os três provedores valem, no principal E no fallback.
create or replace function public.set_agent_ai_config(p_config jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
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
    if v_prov is null or v_prov not in ('gemini','anthropic','openai') then
      raise exception 'provider invalido: % (suportados: gemini, anthropic, openai)', v_prov;
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
    if f_prov is not null and f_prov in ('gemini','anthropic','openai') and coalesce(trim(f_model),'') <> '' then
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
