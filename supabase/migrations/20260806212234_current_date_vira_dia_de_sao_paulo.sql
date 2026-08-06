-- CLAUDE.md secao 0.1: "Dia de negocio e (now() at time zone 'America/Sao_Paulo')::date, nunca
-- now()::date cru". CURRENT_DATE resolve no TimeZone da sessao, que no PostgREST e UTC, entao
-- das 21h a meia-noite (horario de Brasilia) ele ja e o dia SEGUINTE.
--
-- Sobrou em 4 funcoes. Achado ao revisar a correcao de 06/08/2026 (o alerta era so a primeira):
--
--  1. get_commercial_dashboard_impl  -> janela padrao do grafico diario. Depois das 21h o grafico
--     perde o primeiro dia e ganha um dia futuro sempre vazio.
--  2. close_sale_from_orcamento      -> ⚠️ O PIOR. `if validade < CURRENT_DATE then vencido`.
--     Depois das 21h, orcamento que vale ATE HOJE e recusado como vencido. O cliente perde a
--     venda por 3 horas de relogio, e a mensagem de erro diz que o orcamento venceu.
--  3. fn_estimate_production_due_date-> prazo de producao gravado 1 dia a mais a noite.
--  4. simulate_production_eta        -> mesma coisa, na simulacao mostrada na tela.
--
-- Substituicao EXATA sobre o texto que esta no banco, com verificacao, para nao arrastar
-- nenhuma outra alteracao junto.
do $$
declare
  f text; src text; novo text; n int;
  procs text[] := array['get_commercial_dashboard_impl','close_sale_from_orcamento',
                        'fn_estimate_production_due_date','simulate_production_eta'];
  total int := 0;
begin
  foreach f in array procs loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=f;
    if src is null then raise exception 'Funcao % nao encontrada', f; end if;

    n := (length(src) - length(replace(src, 'CURRENT_DATE', ''))) / 12;
    if n = 0 then raise exception 'CURRENT_DATE nao encontrado em %', f; end if;

    novo := replace(src, 'CURRENT_DATE', '(now() at time zone ''America/Sao_Paulo'')::date');

    if position('CURRENT_DATE' in novo) > 0 then
      raise exception 'Sobrou CURRENT_DATE em %', f;
    end if;
    total := total + n;
    execute novo;
  end loop;
  raise notice 'Trocas aplicadas: %', total;
end $$;

-- _impl nunca pode ser chamavel pelo PostgREST: quem tem o guard e o wrapper (CLAUDE.md secao 1).
revoke all on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) from public, anon, authenticated;
