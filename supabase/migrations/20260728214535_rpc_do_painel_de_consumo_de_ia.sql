-- ⚠️ SUPERADA em parte por 20260728221540_correcoes_do_monitor_de_ia.sql (mesmo dia):
--    ordenacao por texto, custo de bytes como token e re-parse da moeda foram corrigidos la.
--    Mantida no historico porque foi o que rodou primeiro em producao.

-- RPC do painel de consumo de IA (Super Admin).
--
-- Agrega no BANCO, nao no navegador: sao dezenas de milhares de linhas por mes e somar no front
-- cairia na mesma armadilha do §2 do CLAUDE.md (o PostgREST clampa a resposta em max_rows e o
-- total mente sem avisar).
--
-- O custo sai de system_settings.llm_prices (US$ por 1 MILHAO), editavel sem deploy: preco de LLM
-- muda sozinho. Modelo sem preco cadastrado entra com custo ZERO e aparece em `modelos_sem_preco`,
-- para o painel poder avisar em vez de mostrar um total silenciosamente menor.

create or replace function public.get_llm_usage_summary(
  p_from date default null,
  p_to   date default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_from timestamptz; v_to timestamptz;
  v_precos jsonb; v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'apenas super admin';
  end if;

  -- Dia de negocio e dia em SP (§0.1). O `+1 dia` inclui o dia final inteiro.
  v_from := ((coalesce(p_from, (now() at time zone 'America/Sao_Paulo')::date - 29))::timestamp
             at time zone 'America/Sao_Paulo');
  v_to   := ((coalesce(p_to,   (now() at time zone 'America/Sao_Paulo')::date) + 1)::timestamp
             at time zone 'America/Sao_Paulo');

  begin
    select coalesce(nullif(value,'')::jsonb, '{}'::jsonb) into v_precos
      from public.system_settings where id = 'llm_prices';
  exception when others then v_precos := '{}'::jsonb;
  end;
  v_precos := coalesce(v_precos->'modelos', '{}'::jsonb);

  with base as (
    select u.*,
           coalesce((v_precos->u.model->>'in')::numeric, 0)  as p_in,
           coalesce((v_precos->u.model->>'out')::numeric, 0) as p_out,
           (v_precos ? u.model) as tem_preco
      from public.llm_usage u
     where u.created_at >= v_from and u.created_at < v_to
  ),
  calc as (
    select b.*,
           case when b.unit_kind is not null
                -- Cobrado por unidade (TTS: caractere): usa o preco de ENTRADA do modelo.
                then (b.units::numeric / 1000000) * b.p_in
                else (b.tokens_in::numeric / 1000000) * b.p_in
                   + (b.tokens_out::numeric / 1000000) * b.p_out
           end as custo
      from base b
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object(
      'de', coalesce(p_from, (now() at time zone 'America/Sao_Paulo')::date - 29),
      'ate', coalesce(p_to, (now() at time zone 'America/Sao_Paulo')::date)),
    'total', (select jsonb_build_object(
        'chamadas', count(*), 'falhas', count(*) filter (where not ok),
        'tokens_in', coalesce(sum(tokens_in),0), 'tokens_out', coalesce(sum(tokens_out),0),
        'custo', round(coalesce(sum(custo),0), 4)) from calc),
    'por_funcao', (select coalesce(jsonb_agg(x order by x->>'custo' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'feature', feature,
          'chamadas', count(*), 'falhas', count(*) filter (where not ok),
          'tokens_in', coalesce(sum(tokens_in),0), 'tokens_out', coalesce(sum(tokens_out),0),
          'custo', round(coalesce(sum(custo),0), 4)) as x
        from calc group by feature) t),
    'por_escopo', (select coalesce(jsonb_agg(x order by x->>'custo' desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'feature', feature, 'scope', scope,
          'chamadas', count(*), 'falhas', count(*) filter (where not ok),
          'custo', round(coalesce(sum(custo),0), 4)) as x
        from calc group by feature, scope) t),
    'por_clinica', (select coalesce(jsonb_agg(x order by (x->>'custo')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'clinic_id', c.clinic_id,
          'nome', coalesce(cl.name, '(sem clínica)'),
          'chamadas', count(*), 'falhas', count(*) filter (where not c.ok),
          'tokens_in', coalesce(sum(c.tokens_in),0), 'tokens_out', coalesce(sum(c.tokens_out),0),
          'custo', round(coalesce(sum(c.custo),0), 4)) as x
        from calc c left join public.clinics cl on cl.id = c.clinic_id
        group by c.clinic_id, cl.name) t),
    'por_modelo', (select coalesce(jsonb_agg(x order by (x->>'custo')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'provider', provider, 'model', coalesce(model,'(sem modelo)'),
          'tem_preco', bool_or(tem_preco),
          'chamadas', count(*),
          'tokens_in', coalesce(sum(tokens_in),0), 'tokens_out', coalesce(sum(tokens_out),0),
          'unidades', coalesce(sum(units),0),
          'custo', round(coalesce(sum(custo),0), 4)) as x
        from calc group by provider, model) t),
    'por_dia', (select coalesce(jsonb_agg(x order by x->>'dia'), '[]'::jsonb) from (
        select jsonb_build_object(
          'dia', (created_at at time zone 'America/Sao_Paulo')::date,
          'chamadas', count(*), 'custo', round(coalesce(sum(custo),0), 4)) as x
        from calc group by (created_at at time zone 'America/Sao_Paulo')::date) t),
    'modelos_sem_preco', (select coalesce(jsonb_agg(distinct model), '[]'::jsonb)
        from calc where model is not null and not tem_preco),
    'moeda', coalesce((select (nullif(value,'')::jsonb)->>'moeda' from public.system_settings where id='llm_prices'), 'USD')
  ) into v_out;

  return v_out;
end $function$;

-- Painel do Super Admin chama pelo navegador: precisa de EXECUTE explicito (o alter default
-- privileges do schema revoga de authenticated desde 27/07). O guard is_super_admin() la dentro
-- e quem barra quem nao pode.
revoke all on function public.get_llm_usage_summary(date,date) from public, anon, authenticated;
grant execute on function public.get_llm_usage_summary(date,date) to authenticated;
