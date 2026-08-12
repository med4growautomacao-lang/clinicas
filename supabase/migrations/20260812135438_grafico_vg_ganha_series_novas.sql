-- Gráfico de tendência da Visão Geral: séries novas (vendas lançadas, ticket médio e orçamentos).
--
-- Os cards já mostravam esses números no total do período; o gráfico só sabia desenhar leads,
-- agendados, clientes, faturamento, investimento e ROAS. Aqui a série DIÁRIA passa a carregar
-- os mesmos conceitos, para o dono ver a curva e não só o acumulado.
--
-- 📌 A contagem de vendas do dia sai da MESMA CTE que já soma o valor do dia (COUNT ao lado do
-- SUM): é o que garante que o ticket médio diário (valor ÷ vendas, calculado na tela) seja
-- coerente com o card de Ticket Médio do período.
-- 📌 Orçamentos entram por dia de ENVIO, com valor e quantos viraram venda — mesma view canônica
-- (v_kpi_quotes) e mesmos filtros de origem/canal/agente do resto do painel.
do $mig$
declare
  v_def text;
  v_a   text;
  v_b   text;
begin
  v_def := pg_get_functiondef('public.get_dashboard_stats_impl(uuid,date,date,text,text,text)'::regprocedure);

  -- 1) quantas vendas por dia, do mesmo SELECT que já soma o valor do dia
  v_a := 'revenue AS (SELECT (c.converted_at at time zone ''America/Sao_Paulo'')::date AS date, SUM(c.value::numeric) as total FROM conversions c';
  v_b := 'revenue AS (SELECT (c.converted_at at time zone ''America/Sao_Paulo'')::date AS date, SUM(c.value::numeric) as total, COUNT(*) as qty FROM conversions c';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'ancora da CTE revenue ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  -- 2) orçamentos por dia de envio (quantidade, valor e quantos viraram venda)
  v_a := '  invest_d AS (SELECT day AS date, SUM(investment) as total FROM v_kpi_investment';
  v_b := '  quotes_d AS (SELECT q.day AS date, COUNT(*) as qty, COALESCE(SUM(q.value), 0) as total,' || chr(10) ||
         '    COUNT(*) FILTER (WHERE q.won) as ganhos' || chr(10) ||
         '    FROM v_kpi_quotes q LEFT JOIN leads l ON l.id = q.lead_id' || chr(10) ||
         '    WHERE q.clinic_id = p_clinic_id AND q.day BETWEEN p_date_from AND p_date_to' || chr(10) ||
         '      AND (p_origin = ''todos''' || chr(10) ||
         '        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, '','')))' || chr(10) ||
         '      AND (p_channel = ''todos'' OR l.capture_channel = ANY(string_to_array(p_channel, '','')))' || chr(10) ||
         '      AND (p_agent = ''todos'' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))' || chr(10) ||
         '    GROUP BY q.day),' || chr(10) || v_a;
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'ancora da CTE invest_d ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  -- 3) as chaves novas no ponto do dia
  v_a := '''investimento'', COALESCE(i.total, 0)) ORDER BY d)';
  v_b := '''investimento'', COALESCE(i.total, 0),' || chr(10) ||
         '      ''vendas_lancadas'', COALESCE(r.qty, 0),' || chr(10) ||
         '      ''orcamentos'', COALESCE(q.qty, 0), ''orcamentos_valor'', COALESCE(q.total, 0),' || chr(10) ||
         '      ''orcamentos_ganhos'', COALESCE(q.ganhos, 0)) ORDER BY d)';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'ancora do jsonb do grafico ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  v_a := '  LEFT JOIN sales_d s ON s.date = dates.d LEFT JOIN invest_d i ON i.date = dates.d;';
  v_b := '  LEFT JOIN sales_d s ON s.date = dates.d LEFT JOIN invest_d i ON i.date = dates.d' || chr(10) ||
         '  LEFT JOIN quotes_d q ON q.date = dates.d;';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'ancora do FROM do grafico ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  execute v_def;
end;
$mig$;
