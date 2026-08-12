-- 20260719162002_build_commercial_report_blank_line
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='build_commercial_report';

  v_new := replace(v_def,
    $o$lines := array_append(lines, '*💰 FINANCEIRO*');$o$,
    $n$lines := array_append(lines, '');
    lines := array_append(lines, '*💰 FINANCEIRO*');$n$);

  IF v_new = v_def THEN RAISE EXCEPTION 'substituicao nao aplicada'; END IF;
  EXECUTE v_new;
END $mig$;
