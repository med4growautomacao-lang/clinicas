-- Gestão da Organização: "Ticket Médio" era a META, não o ticket.
--
-- O painel mostrava `ai_config.default_ticket_value` sob o rótulo "Ticket Médio", enquanto Visão
-- Geral, Marketing e Resultados passaram a mostrar o ticket REAL (valor lançado ÷ nº de vendas).
-- Mesmo rótulo com duas definições em telas diferentes é divergência de DEFINIÇÃO, que por regra
-- da casa é bug. Aqui o `ticketMedio` vira o real; a meta continua exposta, com o nome certo.
--
-- Também sai daqui o `salesCount` (nº de vendas lançadas), que é o denominador do ticket real e
-- o que permite ao front somar o total da organização como deve ser: soma dos valores ÷ soma das
-- vendas, e não média das médias.
do $mig$
declare
  v_def text;
  v_a   text;
  v_b   text;
begin
  v_def := pg_get_functiondef('public.get_org_clinics_metrics'::regproc);

  -- 1) a lateral do faturamento passa a devolver também a CONTAGEM (mesmo WHERE, sem divergir)
  v_a := 'SELECT COALESCE(SUM(cv.value::numeric), 0) AS total';
  v_b := 'SELECT COALESCE(SUM(cv.value::numeric), 0) AS total, COUNT(*) AS qty';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_org_clinics_metrics: ancora do faturamento ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  v_a := 'rv.total AS revenue, iv.total AS investment,';
  v_b := 'rv.total AS revenue, COALESCE(rv.qty, 0) AS sales_count, iv.total AS investment,';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_org_clinics_metrics: ancora do select interno ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  -- 2) ticketMedio = REAL; a meta configurada continua, agora chamada de ticketMeta
  v_a := '''ticketMedio'', m.ticket_medio';
  v_b := '''ticketMedio'', CASE WHEN m.sales_count > 0 THEN ROUND(m.revenue / m.sales_count, 2) END,' || chr(10) ||
         '    ''salesCount'', m.sales_count,' || chr(10) ||
         '    ''ticketMeta'', m.ticket_medio';
  if (length(v_def) - length(replace(v_def, v_a, ''))) <> length(v_a) then
    raise exception 'get_org_clinics_metrics: ancora do ticketMedio ausente ou repetida — nada aplicado';
  end if;
  v_def := replace(v_def, v_a, v_b);

  execute v_def;
end;
$mig$;
