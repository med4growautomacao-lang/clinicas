-- 20260720201243_meta_capi_provider_mode
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

update public.system_settings
   set value = (coalesce(value::jsonb, '{}'::jsonb) || '{"provider_mode": false}'::jsonb)::text,
       updated_at = now()
 where id = 'meta_capi_config'
   and not (value::jsonb ? 'provider_mode');

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
