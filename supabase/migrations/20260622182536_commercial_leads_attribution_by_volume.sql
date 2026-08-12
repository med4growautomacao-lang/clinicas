-- 20260622182536_commercial_leads_attribution_by_volume
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  src := replace(src,
$a_old$      bool_or(cm.sender = 'ai') AS got_ia,
      bool_or(cm.sender = 'human' AND cm.direction = 'outbound') AS got_human$a_old$,
$a_new$      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_out,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_out$a_new$);

  src := replace(src,
$c_old$  SELECT
    COUNT(*) FILTER (WHERE got_ia),
    COUNT(*) FILTER (WHERE got_human AND NOT got_ia)
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM per_lead;$c_old$,
$c_new$  SELECT
    COUNT(*) FILTER (WHERE (ai_out + human_out) > 0 AND ai_out >= human_out),
    COUNT(*) FILTER (WHERE human_out > ai_out)
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM per_lead;$c_new$);

  EXECUTE src;
END $do$;
