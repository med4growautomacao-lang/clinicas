-- Conversoes OFFLINE (adiantado, atras de flag send_offline, default false).
-- A partir de mai/2025 a Meta descontinuou a Offline Conversions API: tudo vai pela Conversions API
-- unificada. Leads SEM ctwa_clid (organicos) nao entram no dataset da WABA (mensageria) -> em vez de
-- pular, mandamos como evento OFFLINE para o PIXEL (dataset unificado, clinics.meta_pixel_id),
-- casando por telefone/e-mail/nome com hash. action_source = system_generated (lead de CRM) ou
-- physical_store (presenca fisica). Janela ate 62 dias.

update public.system_settings
   set value = (coalesce(value::jsonb, '{}'::jsonb) || '{"send_offline": false, "offline_action_source": "system_generated"}'::jsonb)::text,
       updated_at = now()
 where id = 'meta_capi_config'
   and not (value::jsonb ? 'send_offline');

create or replace function public.set_meta_capi_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur       jsonb   := coalesce((select value::jsonb from public.system_settings where id = 'meta_capi_config'), '{}'::jsonb);
  v_enabled   boolean := coalesce((p_config->>'enabled')::boolean,       (v_cur->>'enabled')::boolean,       false);
  v_batch     int     := coalesce((p_config->>'batch_size')::int,        (v_cur->>'batch_size')::int,        25);
  v_provider  boolean := coalesce((p_config->>'provider_mode')::boolean, (v_cur->>'provider_mode')::boolean, false);
  v_offline   boolean := coalesce((p_config->>'send_offline')::boolean,  (v_cur->>'send_offline')::boolean,  false);
  v_off_src   text    := coalesce(p_config->>'offline_action_source',    v_cur->>'offline_action_source',    'system_generated');
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_batch < 1 or v_batch > 500 then
    raise exception 'batch_size fora de 1..500';
  end if;
  if v_off_src not in ('system_generated', 'physical_store', 'other') then
    raise exception 'offline_action_source invalido (system_generated | physical_store | other)';
  end if;

  insert into public.system_settings (id, value, description, updated_at)
  values (
    'meta_capi_config',
    jsonb_build_object(
      'enabled', v_enabled, 'batch_size', v_batch, 'provider_mode', v_provider,
      'send_offline', v_offline, 'offline_action_source', v_off_src
    )::text,
    'API de Conversoes CAPI (CTWA + offline): liga/desliga, lote, modo Tech Provider e envio offline (pixel).',
    now()
  )
  on conflict (id) do update set value = excluded.value, updated_at = now();

  return (select value::jsonb from public.system_settings where id = 'meta_capi_config');
end;
$$;
revoke all on function public.set_meta_capi_config(jsonb) from public, anon;
grant execute on function public.set_meta_capi_config(jsonb) to authenticated;
