-- set_ad_spend_sync_config: MERGE PARCIAL em vez de reconstruir o jsonb do zero.
--
-- Defeito corrigido (30/07/2026): a função montava a config com jsonb_build_object de 6 campos
-- fixos, então TODO campo que ela não conhecia era apagado ao salvar. Perdiam-se
-- `breakdown_enabled` (liga o detalhamento por campanha/anúncio) e `conversions_lookback_days`.
-- Efeito real, medido no dia: bastou alguém abrir Super Admin › Configurações › Investimento e
-- salvar para o detalhamento por anúncio parar de ser gravado em TODAS as clínicas, sem erro
-- nenhum. A grade de campanhas do Marketing seguia mostrando os números antigos, congelados.
-- (A tela não é culpada: ela devolve os campos extras no p_config; era a RPC que os descartava.)
--
-- Agora a função parte do que ESTÁ gravado e sobrescreve apenas os campos validados. Campo novo
-- que o painel venha a editar precisa ser acrescentado aqui (validação + jsonb_build_object);
-- campo que só existe no banco sobrevive sozinho.
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

  -- valor atual como base do merge. O bloco com exception existe porque `value` é TEXT: se algum dia
  -- houver texto que não seja JSON válido, o cast derrubaria o salvamento inteiro; melhor recomeçar
  -- de um objeto vazio do que impedir o super-admin de configurar.
  begin
    select coalesce(value::jsonb, '{}'::jsonb) into v_atual
    from public.system_settings where id = 'ad_spend_sync_config';
  exception when others then
    v_atual := '{}'::jsonb;
  end;

  -- Só os campos validados entram. Campo desconhecido vindo do cliente NÃO passa (não queremos
  -- lixo na config), e campo desconhecido JÁ GRAVADO permanece (é o conserto desta migration).
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

-- ACL reafirmada: create or replace preserva a existente, mas o grant vem por DOIS caminhos (o
-- PUBLIC implícito e o nominal), então deixar explícito evita reabrir para anon num replace futuro.
revoke all on function public.set_ad_spend_sync_config(jsonb) from public, anon;
grant execute on function public.set_ad_spend_sync_config(jsonb) to authenticated;
