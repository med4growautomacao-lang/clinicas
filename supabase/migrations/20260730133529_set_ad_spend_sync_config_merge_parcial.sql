-- 20260730133529_set_ad_spend_sync_config_merge_parcial
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create or replace function public.set_ad_spend_sync_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_enabled boolean := coalesce((p_config->>'enabled')::boolean, false);
  v_every int := coalesce((p_config->>'every_hours')::int, 24);
  v_hour int := coalesce((p_config->>'run_hour_sp')::int, 5);
  v_look int := coalesce((p_config->>'lookback_days')::int, 1);
  v_batch int := coalesce((p_config->>'batch_size')::int, 300);
  v_platforms jsonb := coalesce(p_config->'platforms', '["meta_ads","google_ads"]'::jsonb);
  v_p text;
  v_atual jsonb := '{}'::jsonb;
  v_novo jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_every < 1 or v_every > 168 then raise exception 'every_hours fora de 1..168'; end if;
  if v_hour < 0 or v_hour > 23 then raise exception 'run_hour_sp fora de 0..23'; end if;
  if v_look < 1 or v_look > 30 then raise exception 'lookback_days fora de 1..30'; end if;
  if v_batch < 1 or v_batch > 2000 then raise exception 'batch_size fora de 1..2000'; end if;
  for v_p in select jsonb_array_elements_text(v_platforms) loop
    if v_p not in ('meta_ads','google_ads') then raise exception 'plataforma inválida: %', v_p; end if;
  end loop;

  begin
    select coalesce(value::jsonb, '{}'::jsonb) into v_atual
    from public.system_settings where id = 'ad_spend_sync_config';
  exception when others then
    v_atual := '{}'::jsonb;
  end;

  v_novo := coalesce(v_atual, '{}'::jsonb) || jsonb_build_object(
    'enabled', v_enabled, 'every_hours', v_every, 'run_hour_sp', v_hour,
    'lookback_days', v_look, 'platforms', v_platforms, 'batch_size', v_batch
  );

  insert into public.system_settings (id, value, description, updated_at)
  values (
    'ad_spend_sync_config',
    v_novo::text,
    'Agendador de investimento: liga/desliga, intervalo (h), hora fixa SP, lookback (dias), plataformas, lote.',
    now()
  )
  on conflict (id) do update set value = excluded.value, updated_at = now();

  return v_novo;
end;
$function$;

revoke all on function public.set_ad_spend_sync_config(jsonb) from public, anon;
grant execute on function public.set_ad_spend_sync_config(jsonb) to authenticated;
