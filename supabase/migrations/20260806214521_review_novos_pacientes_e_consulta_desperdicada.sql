-- Dois achados do code-review de 06/08/2026, ambos pequenos e independentes.
--
-- (1) "Novos Pacientes" (Visao Geral) contava a MESMA pessoa duas vezes.
--     COUNT(*) sobre patients LEFT JOIN leads pelo converted_patient_id: quando duas entradas
--     de lead apontam para o mesmo paciente, o join emite 2 linhas e o card soma 2 por 1 pessoa.
--     Medido hoje: 1 paciente nessa situacao, entao o card inflava exatamente 1. Cresce com a
--     base, e a duplicidade de lead e rotina neste sistema ("quase sempre a mesma pessoa em 2
--     leads", CLAUDE.md). O irmao v_total_appointments ja conta 1 por ticket, via v_kpi_scheduled.
--
-- (2) Consulta rodando a toa no caminho quente da lista de leads.
--     Para clinica com agenda_via_funil, a cadeia IF caia no ELSE, rodava um COUNT sobre
--     leads x tickets x appointments (com fn_lead_matches_agent por linha) e o resultado era
--     sobrescrito na linha seguinte pelo bloco que le a ETAPA. Agora o ELSE e guardado.
do $$
declare src text; novo text; n int;
  a1 constant text := 'SELECT COUNT(*) INTO v_new_patients';
  a2 constant text := E'  ELSE\n    -- COUNT(*), nao COUNT(DISTINCT lead)';
begin
  -- (1) Visao Geral
  select pg_get_functiondef(p.oid) into src from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname='get_dashboard_stats_impl';
  n := (length(src)-length(replace(src,a1,'')))/length(a1);
  if n <> 1 then raise exception 'esperava 1 contagem de novos pacientes, achei %', n; end if;
  novo := replace(src, a1,
    E'-- COUNT(DISTINCT pt.id): o LEFT JOIN com leads emite uma linha por lead, e paciente\n  -- alcancado por dois leads apareceria duas vezes no card.\n  SELECT COUNT(DISTINCT pt.id) INTO v_new_patients');
  execute novo;

  -- (2) Lista de leads
  select pg_get_functiondef(p.oid) into src from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname='get_commercial_leads_impl';
  n := (length(src)-length(replace(src,a2,'')))/length(a2);
  if n <> 1 then raise exception 'esperava 1 ramo ELSE de agendamento, achei %', n; end if;
  novo := replace(src, a2,
    E'  ELSIF NOT (v_agenda_funil AND p_metric IN (''gerados'', ''realizadas'')) THEN\n'
    || E'    -- ⚠️ A guarda nao e enfeite: clinica que agenda pelo funil e resolvida no bloco de\n'
    || E'    -- ETAPA logo abaixo. Sem ela, esta consulta de 3 tabelas roda no caminho quente da\n'
    || E'    -- lista e o resultado e sobrescrito na linha seguinte.\n'
    || E'    -- COUNT(*), nao COUNT(DISTINCT lead)');
  execute novo;

  if (select position('COUNT(DISTINCT pt.id)' in prosrc) from pg_proc
      where pronamespace='public'::regnamespace and proname='get_dashboard_stats_impl') = 0
     or (select position('ELSIF NOT (v_agenda_funil' in prosrc) from pg_proc
      where pronamespace='public'::regnamespace and proname='get_commercial_leads_impl') = 0 then
    raise exception 'alguma das duas correcoes nao entrou';
  end if;
end $$;

revoke all on function public.get_dashboard_stats_impl(uuid, date, date, text, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from public, anon, authenticated;
