-- Nº de VENDAS LANÇADAS nos painéis Visão Geral e Resultados (Comercial).
--
-- Os dois painéis já mostravam o VALOR das vendas lançadas (conversions, eixo converted_at)
-- e a contagem de CARDS ganhos (tickets.outcome='ganho'). Desde que o mesmo card passou a
-- aceitar várias vendas, esses dois números deixaram de responder "quantas vendas houve":
-- faltava a CONTAGEM de lançamentos. É só isso que entra aqui.
--
-- 📌 A contagem sai do MESMO SELECT que já soma o valor (COUNT(*) ao lado do SUM), de propósito:
-- garante recorte e eixo de data idênticos ao card de R$ que fica ao lado. Um SELECT novo,
-- ainda que copiado, poderia divergir na próxima vez que alguém mexesse só num dos dois.
--
-- ⚠️ PATCH ANCORADO, não reescrita. As duas funções têm 14 KB e 42 KB; reescrever o corpo
-- inteiro numa migration é o caminho mais curto para desfazer, sem perceber, o trabalho de
-- outra sessão (já custou uma venda perdida em 10/08). Aqui a migration lê a definição VIVA,
-- troca 3 trechos exatos e regrava. Se qualquer âncora tiver mudado, ela FALHA e não aplica
-- nada, em vez de publicar um corpo velho por cima do novo.
--
-- CREATE OR REPLACE preserva dono e privilégios (não reabre EXECUTE para anon/authenticated)
-- e mantém a assinatura, então não cria overload nova.
do $mig$
declare
  v_def text;
  v_a   text;
  v_b   text;
begin
  -- ===================== 1) Visão Geral: get_dashboard_stats_impl =====================
  v_def := pg_get_functiondef('public.get_dashboard_stats_impl(uuid,date,date,text,text,text)'::regprocedure);

  v_a := '  v_total_conversions_value numeric;';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_dashboard_stats_impl: ancora do DECLARE ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_a || chr(10) || '  v_sales_count int;');

  v_a := 'SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_total_conversions_value';
  v_b := 'SELECT COALESCE(SUM(c.value::numeric), 0), COUNT(*) INTO v_total_conversions_value, v_sales_count';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_dashboard_stats_impl: ancora do SUM(conversions) ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  v_a := '''salesValue'', v_total_conversions_value,';
  v_b := '''salesValue'', v_total_conversions_value, ''salesCount'', COALESCE(v_sales_count,0),';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_dashboard_stats_impl: ancora do RETURN ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  execute v_def;

  -- ============== 2) Resultados (Comercial): get_commercial_dashboard_impl ==============
  -- Aqui a âncora é o revenue ESCOPADO (o que o card "Vendas lançadas" mostra), não o
  -- v_revenue cru: a contagem tem que obedecer aos filtros de agente, origem e canal da tela.
  v_def := pg_get_functiondef('public.get_commercial_dashboard_impl(uuid,date,date,date,date,text,text,text,date,date,text,text)'::regprocedure);

  v_a := 'v_revenue_scoped numeric;';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_commercial_dashboard_impl: ancora do DECLARE ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_a || ' v_sales_count int;');

  v_a := 'SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_revenue_scoped';
  v_b := 'SELECT COALESCE(SUM(c.value::numeric), 0), COUNT(*) INTO v_revenue_scoped, v_sales_count';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_commercial_dashboard_impl: ancora do SUM(conversions) ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  v_a := '''revenueScoped'', COALESCE(v_revenue_scoped,0),';
  v_b := '''revenueScoped'', COALESCE(v_revenue_scoped,0), ''salesCount'', COALESCE(v_sales_count,0),';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_commercial_dashboard_impl: ancora do RETURN ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  execute v_def;
end;
$mig$;
