-- DIA DE NEGOCIO = America/Sao_Paulo tambem nas RPCs de painel (CLAUDE.md secao 0.1).
--
-- As views canonicas (v_kpi_wins, v_kpi_sales_value, v_kpi_outcomes) SEMPRE cortaram por
-- 'America/Sao_Paulo'. As RPCs cortavam por UTC, porque <coluna timestamptz>::date usa o
-- TimeZone da sessao, que no PostgREST e UTC. Isso e divergencia de DEFINICAO entre paineis,
-- que pelo CLAUDE.md e bug, nao recorte legitimo.
--
-- Ficava visivel DENTRO do mesmo painel: no Comercial, "Perdido por motivo" ja saia de
-- v_kpi_outcomes (dia de SP) enquanto o total de "Perdido" ao lado vinha de tickets cru
-- (dia UTC). Os dois contavam a mesma coisa por reguas diferentes.
--
-- Impacto medido em 06/08/2026, antes de aplicar:
--   conversions (faturamento) ... 208 linhas,   0 mudam de dia  (faturamento NAO muda)
--   desfecho de ticket .......... 7.948 linhas, 409 mudam de dia (50 ganho, 359 perdido)
--   ... desses 409, apenas 3 mudam de MES em todo o historico (1 ganho, 2 perdido)
--   leads.csat_answered_at ...... 0 linhas
-- Ou seja: o grafico diario acerta 409 pontos; o numero do mes praticamente nao se move.
--
-- ⚠️ As 4 funcoes tem que virar JUNTAS. get_commercial_leads_impl e a lista que abre ao clicar
-- no card do Comercial: se ela ficar em UTC, o card diz um numero e a lista mostra outro.
-- A troca e por substituicao EXATA sobre o texto que esta no banco, com verificacao de que cada
-- trecho existia e sumiu, para nao arrastar nenhuma outra alteracao junto.
do $$
declare
  f text; src text; novo text; n int;
  sp constant text := 'America/Sao_Paulo';
  procs text[] := array['get_dashboard_stats_impl','get_commercial_dashboard_impl',
                        'get_commercial_leads_impl','get_org_clinics_metrics'];
  -- (velho, novo) aplicados a todas; os que nao existirem na funcao sao ignorados,
  -- mas o total de trocas por funcao e conferido no fim.
  -- ⚠️ A ORDEM IMPORTA e os padroes nao tem fronteira de palavra: 'c.converted_at::date' vem
  -- antes de 'cv.converted_at::date' e so e seguro porque nenhum alias destas 4 funcoes termina
  -- em 'c'. Se um dia existir um alias assim (ex.: 'ac.'), este replace o corta no meio e gera
  -- SQL invalido ou, pior, valido e com outro significado. Ao acrescentar par novo, confira o
  -- caractere anterior a cada ocorrencia antes de confiar no contador de trocas.
  pares text[][] := array[
    -- ancoras de janela criadas na correcao de performance de hoje
    array['at time zone ''UTC''', 'at time zone ''America/Sao_Paulo'''],
    -- projecoes do dia (SELECT/GROUP BY do grafico diario)
    array['c.converted_at::date',  '(c.converted_at at time zone ''America/Sao_Paulo'')::date'],
    array['cv.converted_at::date', '(cv.converted_at at time zone ''America/Sao_Paulo'')::date'],
    array['COALESCE(t.outcome_at, t.closed_at)::date',
          '(COALESCE(t.outcome_at, t.closed_at) at time zone ''America/Sao_Paulo'')::date'],
    array['COALESCE(t3.outcome_at, t3.closed_at)::date',
          '(COALESCE(t3.outcome_at, t3.closed_at) at time zone ''America/Sao_Paulo'')::date'],
    array['COALESCE(t4.outcome_at, t4.closed_at)::date',
          '(COALESCE(t4.outcome_at, t4.closed_at) at time zone ''America/Sao_Paulo'')::date']
  ];
  par text[];
  trocas int;
begin
  foreach f in array procs loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=f;
    if src is null then raise exception 'Funcao % nao encontrada', f; end if;
    novo := src; trocas := 0;

    foreach par slice 1 in array pares loop
      n := (length(novo) - length(replace(novo, par[1], ''))) / length(par[1]);
      if n > 0 then
        novo := replace(novo, par[1], par[2]);
        trocas := trocas + n;
      end if;
    end loop;

    -- Comentario que explicava a ancoragem em UTC nao pode continuar mentindo.
    novo := replace(novo,
      '-- O corte do timestamptz e fixado em UTC DE PROPOSITO: e exatamente o que <col>::date fazia',
      '-- O corte do timestamptz e ancorado em America/Sao_Paulo, igual as views canonicas v_kpi_*.');
    novo := replace(novo,
      '-- O corte do timestamptz e ancorado em UTC DE PROPOSITO: e exatamente o que <col>::date fazia',
      '-- O corte do timestamptz e ancorado em America/Sao_Paulo, igual as views canonicas v_kpi_*.');
    novo := replace(novo,
      '-- com o TimeZone=UTC da sessao (conferido 06/08/2026), entao o numero fica igual ao de antes.',
      '-- <col>::date cru usaria o TimeZone da sessao (UTC no PostgREST) e daria outro dia (06/08/2026).');
    novo := replace(novo,
      '-- Trocar para America/Sao_Paulo aqui desloca 3h e muda venda da madrugada de dia, em silencio.',
      '-- Voltar para UTC aqui desloca 3h e faz o painel discordar da view canonica, em silencio.');

    -- Idempotente: reaplicar a cadeia num banco que ja passou por aqui nao pode ABORTAR, senao
    -- as migrations seguintes nem chegam a rodar. Zero trocas + zero ancora UTC = ja aplicado.
    if trocas = 0 then
      if position('at time zone ''UTC''' in src) = 0 and position('America/Sao_Paulo' in src) > 0 then
        raise notice 'ja aplicado em %, pulando', f;
        continue;
      end if;
      raise exception 'Nenhuma troca aplicada em % (texto mudou, revisar a mao)', f;
    end if;
    if position('at time zone ''UTC''' in novo) > 0 then
      raise exception 'Sobrou ancora em UTC em %', f;
    end if;
    raise notice '% -> % trocas', f, trocas;
    execute novo;
  end loop;
end $$;

revoke all on function public.get_dashboard_stats_impl(uuid, date, date, text, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from public, anon, authenticated;
