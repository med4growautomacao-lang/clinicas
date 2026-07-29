-- Correções do monitor de consumo, todas apontadas em code-review. Cinco defeitos reais:
--
-- 1) SEGREDO NO ERRO. O Gemini leva a chave na QUERY STRING e o TypeError de rede do Deno embute a
--    URL inteira: uma queda de rede gravava a chave viva numa tabela de 90 dias. Limpo tambem AQUI
--    (nao so na edge) porque `log_llm_usage` e o unico caminho de escrita: defesa em profundidade,
--    e cobre produtor futuro que esqueca de limpar.
--
-- 2) BYTES COBRADOS COMO TOKEN. `wa-inbound` guarda o TAMANHO da midia em `units` (unit_kind='bytes')
--    e o painel multiplicava isso pelo preco POR TOKEN: uma foto de 500 KB virava US$ 1,50 num
--    modelo de US$ 3/1M. Agora so `chars` (TTS) e cobrado por unidade; `bytes` e volume, nao preco,
--    e as chamadas sem custo medido aparecem em `sem_custo_medido`.
--
-- 3) ORDENACAO POR TEXTO. `order by x->>'custo' desc` compara STRING, entao o painel mostrava o
--    mais BARATO primeiro, invertendo a pergunta que ele existe para responder.
--
-- 4) MOEDA RELIA `llm_prices` SEM GUARDA: JSON malformado derrubava a RPC inteira e o guard de
--    cima nao servia de nada.
--
-- 5) MODELO EM PRODUCAO SEM PRECO: faltavam `claude-sonnet-4-6` (fallback do assistente),
--    `claude-opus-4-8` e os dois de transcricao da OpenAI. E `eleven_multilingual_v2` estava com
--    preco ZERO, o que e pior que faltar: com preco cadastrado ele NAO entra no aviso
--    `modelos_sem_preco`, entao a voz aparecia como gratuita para sempre, em silencio.

-- ── 1) Limpeza de segredo no proprio registro ───────────────────────────────
create or replace function public.log_llm_usage(
  p_feature text,
  p_scope text,
  p_provider text,
  p_model text default null,
  p_clinic_id uuid default null,
  p_tokens_in integer default 0,
  p_tokens_out integer default 0,
  p_ok boolean default true,
  p_error text default null,
  p_duration_ms integer default null,
  p_units integer default 0,
  p_unit_kind text default null,
  p_lead_id uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_err text;
begin
  v_err := nullif(btrim(p_error), '');
  if v_err is not null then
    v_err := regexp_replace(v_err, '([?&](key|api_key|api-key|token|access_token)=)[^&\s"'')]+', '\1[REMOVIDO]', 'gi');
    v_err := regexp_replace(v_err, 'AIza[0-9A-Za-z_\-]{10,}', '[REMOVIDO]', 'g');
    v_err := regexp_replace(v_err, 'sk-(ant-)?[A-Za-z0-9_\-]{10,}', '[REMOVIDO]', 'g');
    v_err := left(v_err, 500);
  end if;

  insert into public.llm_usage (
    clinic_id, lead_id, feature, scope, provider, model,
    tokens_in, tokens_out, units, unit_kind, ok, error, duration_ms
  ) values (
    p_clinic_id, p_lead_id,
    coalesce(nullif(btrim(p_feature),''), 'desconhecido'),
    coalesce(nullif(btrim(p_scope),''), 'desconhecido'),
    coalesce(nullif(btrim(p_provider),''), 'desconhecido'),
    nullif(btrim(p_model),''),
    greatest(coalesce(p_tokens_in,0), 0), greatest(coalesce(p_tokens_out,0), 0),
    greatest(coalesce(p_units,0), 0), nullif(btrim(p_unit_kind),''),
    coalesce(p_ok, true), v_err, p_duration_ms
  );
exception when others then
  null;  -- monitor mudo por design
end $function$;

revoke all on function public.log_llm_usage(text,text,text,text,uuid,integer,integer,boolean,text,integer,integer,text,uuid) from public, anon, authenticated;

-- Linhas ja gravadas antes desta correcao.
update public.llm_usage
   set error = left(regexp_replace(
                 regexp_replace(error, '([?&](key|api_key|api-key|token|access_token)=)[^&\s"'')]+', '\1[REMOVIDO]', 'gi'),
                 'AIza[0-9A-Za-z_\-]{10,}', '[REMOVIDO]', 'g'), 500)
 where error is not null
   and (error ~* '[?&](key|api_key|api-key|token|access_token)=' or error ~ 'AIza[0-9A-Za-z_\-]{10,}');

-- ── 5) Preços dos modelos que existem de verdade ────────────────────────────
-- `eleven_multilingual_v2` sai da lista de propósito: sem preço confiável, é melhor aparecer no
-- aviso "sem preço" (com o volume em caracteres) do que mentir US$ 0,00.
-- Merge, nunca reconstrução (§2): preserva o que o dono já tiver ajustado à mão.
update public.system_settings s
   set value = (
     coalesce(nullif(s.value,'')::jsonb, '{}'::jsonb)
     || jsonb_build_object('modelos',
          (coalesce(coalesce(nullif(s.value,'')::jsonb, '{}'::jsonb)->'modelos', '{}'::jsonb) - 'eleven_multilingual_v2'::text)
          || jsonb_build_object(
               'claude-sonnet-4-6',      jsonb_build_object('in', 3.00, 'out', 15.0),
               'claude-opus-4-8',        jsonb_build_object('in', 15.0, 'out', 75.0),
               'gpt-4o-mini-transcribe', jsonb_build_object('in', 1.25, 'out', 5.00),
               'gpt-4o-transcribe',      jsonb_build_object('in', 2.50, 'out', 10.0)
             )
        )
   )::text
 where s.id = 'llm_prices';

-- ── 2, 3 e 4) Painel: custo, ordenação e moeda ──────────────────────────────
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
  v_precos jsonb; v_cfg jsonb; v_moeda text; v_out jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'apenas super admin';
  end if;

  v_from := ((coalesce(p_from, (now() at time zone 'America/Sao_Paulo')::date - 29))::timestamp
             at time zone 'America/Sao_Paulo');
  v_to   := ((coalesce(p_to,   (now() at time zone 'America/Sao_Paulo')::date) + 1)::timestamp
             at time zone 'America/Sao_Paulo');

  -- UM parse, protegido. A `moeda` sai daqui: ler de novo com cast cru derrubava a RPC inteira
  -- quando o JSON estava malformado, anulando esta propria guarda.
  begin
    select coalesce(nullif(value,'')::jsonb, '{}'::jsonb) into v_cfg
      from public.system_settings where id = 'llm_prices';
  exception when others then v_cfg := '{}'::jsonb;
  end;
  v_precos := coalesce(v_cfg->'modelos', '{}'::jsonb);
  v_moeda  := coalesce(v_cfg->>'moeda', 'USD');

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
           case
             -- Cobrado por CARACTERE (TTS): preço da lista vale por 1M de caracteres.
             when b.unit_kind = 'chars' then (b.units::numeric / 1000000) * b.p_in
             -- BYTES é volume de mídia, não unidade de cobrança: multiplicar por preço de token
             -- dava número inventado (uma foto de 500 KB virava US$ 1,50). Fica sem custo medido.
             when b.unit_kind is not null then 0::numeric
             else (b.tokens_in::numeric  / 1000000) * b.p_in
                + (b.tokens_out::numeric / 1000000) * b.p_out
           end as custo,
           -- Chamada que aconteceu mas cujo custo NÃO dá para calcular. O painel avisa em vez de
           -- exibir zero como se fosse de graça.
           (b.ok and (
              (b.unit_kind is not null and b.unit_kind <> 'chars')
              or (not b.tem_preco and (b.tokens_in > 0 or b.tokens_out > 0 or b.units > 0))
           )) as sem_custo
      from base b
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object(
      'de', coalesce(p_from, (now() at time zone 'America/Sao_Paulo')::date - 29),
      'ate', coalesce(p_to, (now() at time zone 'America/Sao_Paulo')::date)),
    'total', (select jsonb_build_object(
        'chamadas', count(*), 'falhas', count(*) filter (where not ok),
        'tokens_in', coalesce(sum(tokens_in),0), 'tokens_out', coalesce(sum(tokens_out),0),
        'sem_custo_medido', count(*) filter (where sem_custo),
        'custo', round(coalesce(sum(custo),0), 6)) from calc),
    'por_funcao', (select coalesce(jsonb_agg(x order by (x->>'custo')::numeric desc, (x->>'chamadas')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'feature', feature,
          'chamadas', count(*), 'falhas', count(*) filter (where not ok),
          'sem_custo_medido', count(*) filter (where sem_custo),
          'tokens_in', coalesce(sum(tokens_in),0), 'tokens_out', coalesce(sum(tokens_out),0),
          'custo', round(coalesce(sum(custo),0), 6)) as x
        from calc group by feature) t),
    'por_escopo', (select coalesce(jsonb_agg(x order by (x->>'custo')::numeric desc, (x->>'chamadas')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'feature', feature, 'scope', scope,
          'chamadas', count(*), 'falhas', count(*) filter (where not ok),
          'custo', round(coalesce(sum(custo),0), 6)) as x
        from calc group by feature, scope) t),
    'por_clinica', (select coalesce(jsonb_agg(x order by (x->>'custo')::numeric desc, (x->>'chamadas')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'clinic_id', c.clinic_id,
          'nome', coalesce(cl.name, '(sem clínica)'),
          'chamadas', count(*), 'falhas', count(*) filter (where not c.ok),
          'tokens_in', coalesce(sum(c.tokens_in),0), 'tokens_out', coalesce(sum(c.tokens_out),0),
          'custo', round(coalesce(sum(c.custo),0), 6)) as x
        from calc c left join public.clinics cl on cl.id = c.clinic_id
        group by c.clinic_id, cl.name) t),
    'por_modelo', (select coalesce(jsonb_agg(x order by (x->>'custo')::numeric desc, (x->>'chamadas')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'provider', provider, 'model', coalesce(model,'(sem modelo)'),
          'tem_preco', bool_or(tem_preco),
          'chamadas', count(*),
          'tokens_in', coalesce(sum(tokens_in),0), 'tokens_out', coalesce(sum(tokens_out),0),
          'unidades', coalesce(sum(units),0),
          'unidade', max(unit_kind),
          'custo', round(coalesce(sum(custo),0), 6)) as x
        from calc group by provider, model) t),
    'por_dia', (select coalesce(jsonb_agg(x order by x->>'dia'), '[]'::jsonb) from (
        select jsonb_build_object(
          'dia', (created_at at time zone 'America/Sao_Paulo')::date,
          'chamadas', count(*), 'custo', round(coalesce(sum(custo),0), 6)) as x
        from calc group by (created_at at time zone 'America/Sao_Paulo')::date) t),
    'modelos_sem_preco', (select coalesce(jsonb_agg(distinct model), '[]'::jsonb)
        from calc where model is not null and not tem_preco),
    'moeda', v_moeda
  ) into v_out;

  return v_out;
end $function$;

revoke all on function public.get_llm_usage_summary(date,date) from public, anon, authenticated;
grant execute on function public.get_llm_usage_summary(date,date) to authenticated;
