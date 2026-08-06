-- fn_lead_matches_agent tem SET search_path, e funcao com clausula SET NAO E EMBUTIDA pelo
-- planner. Ou seja: cada ocorrencia vira uma chamada de funcao POR LINHA, e cada chamada faz
-- sua propria busca em lead_kpi_attribution. No painel Comercial ela aparece 10 vezes.
--
-- O detalhe e que a propria funcao comeca com "p_agent = 'todos' OR ...", e 'todos' e o valor
-- PADRAO da tela. Entao, no caso mais comum, o banco pagava a chamada para receber true.
--
-- Aqui a curto-circuita por fora: com p_agent = 'todos' a funcao nao e chamada nenhuma vez.
-- Equivalencia e trivial (mesmo com p_agent NULL: NULL OR fn(NULL,...) da NULL dos dois lados),
-- porque o primeiro ramo da funcao e exatamente esta comparacao.
--
-- ⚠️ NAO resolver isso tirando o SET search_path da funcao para deixar o planner embutir: o
-- search_path fixo e parte do hardening (CLAUDE.md), e vale mais que os milissegundos.
do $$
declare
  f text; src text; novo text; n int; total int := 0;
  velho constant text := 'public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent)';
  curto constant text := '(p_agent = ''todos'' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))';
begin
  foreach f in array array['get_commercial_dashboard_impl','get_commercial_leads_impl'] loop
    select pg_get_functiondef(p.oid) into src from pg_proc p
      where p.pronamespace='public'::regnamespace and p.proname=f;
    -- Ja curto-circuitado? Entao nao ha o que fazer (idempotente).
    if position(curto in src) > 0 then
      raise notice '% ja estava curto-circuitada', f;
      continue;
    end if;
    n := (length(src)-length(replace(src,velho,'')))/length(velho);
    if n = 0 then raise exception 'nenhuma chamada de agente encontrada em %', f; end if;
    novo := replace(src, velho, curto);
    if (length(novo)-length(replace(novo,curto,'')))/length(curto) <> n then
      raise exception 'troca incompleta em %', f;
    end if;
    total := total + n;
    execute novo;
  end loop;
  raise notice 'chamadas curto-circuitadas: %', total;
end $$;

revoke all on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from public, anon, authenticated;
