-- Modo Tech Provider (adiantado, atrás de flag).
-- Quando a PLATAFORMA vira Meta Tech Provider, o token de plataforma (META_CLOUD_TOKEN, System User
-- do BM do provedor) passa a ter acesso a TODAS as WABAs de clientes (via Embedded Signup). Aí a
-- prioridade do token nas edges deve inverter para "plataforma primeiro". Isso fica atrás de
-- provider_mode (default FALSE = comportamento atual, clínica-primeiro), então não afeta o interim
-- antes do cadastro sair — é só ligar o flag no go-live de provedor.

-- Adiciona a chave SEM clobberar enabled/batch (merge parcial).
update public.system_settings
   set value = (coalesce(value::jsonb, '{}'::jsonb) || '{"provider_mode": false}'::jsonb)::text,
       updated_at = now()
 where id = 'meta_capi_config'
   and not (value::jsonb ? 'provider_mode');

-- RPC agora faz MERGE: preserva chaves não informadas (regra "nunca reconstruir JSONB do zero").
create or replace function public.set_meta_capi_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur      jsonb   := coalesce((select value::jsonb from public.system_settings where id = 'meta_capi_config'), '{}'::jsonb);
  v_enabled  boolean := coalesce((p_config->>'enabled')::boolean,       (v_cur->>'enabled')::boolean,       false);
  v_batch    int     := coalesce((p_config->>'batch_size')::int,        (v_cur->>'batch_size')::int,        25);
  v_provider boolean := coalesce((p_config->>'provider_mode')::boolean, (v_cur->>'provider_mode')::boolean, false);
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_batch < 1 or v_batch > 500 then
    raise exception 'batch_size fora de 1..500';
  end if;

  insert into public.system_settings (id, value, description, updated_at)
  values (
    'meta_capi_config',
    jsonb_build_object('enabled', v_enabled, 'batch_size', v_batch, 'provider_mode', v_provider)::text,
    'API de Conversoes CAPI (CTWA): liga/desliga, tamanho do lote e modo Tech Provider (token de plataforma primeiro).',
    now()
  )
  on conflict (id) do update set value = excluded.value, updated_at = now();

  return (select value::jsonb from public.system_settings where id = 'meta_capi_config');
end;
$$;
revoke all on function public.set_meta_capi_config(jsonb) from public, anon;
grant execute on function public.set_meta_capi_config(jsonb) to authenticated;
