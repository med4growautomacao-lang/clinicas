-- Correções da code review (achados #8, #10, #12). Aplicada em produção via MCP
-- apply_migration como 'report_review_fixes'. Método seguro (replace no def atual
-- + assert), não transcreve as funções grandes.

-- #8 e #10 em build_commercial_report:
--   (a) cabeçalho não vira NULL se um par de datas vier meio-aberto (to_char(NULL)
--       anulava toda a concatenação → função retornava NULL);
--   (b) o gate do comparativo passa a considerar também o eixo Conversão (p_appt_from).
DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='build_commercial_report';

  v_new := v_def;
  v_new := replace(v_new,
    $o$to_char(p_entry_from,'DD/MM/YYYY') || ' a ' || to_char(p_entry_to,'DD/MM/YYYY')$o$,
    $n$to_char(p_entry_from,'DD/MM/YYYY') || coalesce(' a ' || to_char(p_entry_to,'DD/MM/YYYY'), '')$n$);
  v_new := replace(v_new,
    $o$to_char(p_appt_from,'DD/MM/YYYY') || ' a ' || to_char(p_appt_to,'DD/MM/YYYY')$o$,
    $n$to_char(p_appt_from,'DD/MM/YYYY') || coalesce(' a ' || to_char(p_appt_to,'DD/MM/YYYY'), '')$n$);
  v_new := replace(v_new,
    $o$if p_compare and (p_entry_from is not null or p_conv_from is not null) then$o$,
    $n$if p_compare and (p_entry_from is not null or p_conv_from is not null or p_appt_from is not null) then$n$);

  IF v_new = v_def THEN RAISE EXCEPTION 'nenhuma substituicao aplicada em build_commercial_report'; END IF;
  IF position($chk$coalesce(' a ' || to_char(p_entry_to$chk$ in v_new) = 0 THEN RAISE EXCEPTION 'header entry nao corrigido'; END IF;
  IF position('or p_appt_from is not null) then' in v_new) = 0 THEN RAISE EXCEPTION 'gate compare nao corrigido'; END IF;
  EXECUTE v_new;
END $mig$;

-- #8 (defesa em profundidade) em send_clinic_report: nunca postar texto NULL/vazio ao uazapi.
DO $mig2$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='send_clinic_report';

  v_new := replace(v_def,
    $o$  v_text := build_commercial_report(p_clinic_id, p_kind, p_entry_from, p_entry_to,
                                    p_conv_from, p_conv_to, p_appt_from, p_appt_to, true);$o$,
    $n$  v_text := build_commercial_report(p_clinic_id, p_kind, p_entry_from, p_entry_to,
                                    p_conv_from, p_conv_to, p_appt_from, p_appt_to, true);

  if v_text is null or btrim(v_text) = '' then
    perform log_system_error('report_send','empty_report',
      'Relatorio gerado vazio/nulo — envio abortado', 'error',
      p_clinic_id, jsonb_build_object('kind', p_kind), false);
    return jsonb_build_object('success', false, 'error', 'relatorio_vazio');
  end if;$n$);

  IF v_new = v_def THEN RAISE EXCEPTION 'guarda de texto vazio nao aplicada em send_clinic_report'; END IF;
  EXECUTE v_new;
END $mig2$;

-- #12 em run_scheduled_reports: advisory lock por transação evita sobreposição de dois ticks.
DO $mig3$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='run_scheduled_reports';

  v_new := replace(v_def,
    $o$  v_count int := 0;
begin$o$,
    $n$  v_count int := 0;
begin
  -- Evita que um tick longo se sobreponha ao próximo (risco de envio duplicado antes do dedup).
  if not pg_try_advisory_xact_lock(hashtext('run_scheduled_reports')) then
    return 0;
  end if;$n$);

  IF v_new = v_def THEN RAISE EXCEPTION 'advisory lock nao aplicado em run_scheduled_reports'; END IF;
  EXECUTE v_new;
END $mig3$;
