-- 20260624041909_commercial_leads_origin_channel_multi
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_leads(uuid,date,date,date,date,text,text,integer,integer,text)'::regprocedure);
  src := regexp_replace(src,
    $re$\(p_origin\s*=\s*'meta'\s+AND\s+l\.source\s*=\s*'meta_ads'\)\s+OR\s+\(p_origin\s*=\s*'google'\s+AND\s+l\.source\s*=\s*'google_ads'\)\s+OR\s+\(p_origin\s*=\s*'balcao'\s+AND\s+l\.source\s*=\s*'balcao'\)\s+OR\s+\(p_origin\s*=\s*'sem_origem'\s+AND\s+\(l\.source\s+IS\s+NULL\s+OR\s+l\.source\s+NOT\s+IN\s*\('meta_ads',\s*'google_ads',\s*'balcao'\)\)\)$re$,
    $rep$(CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))$rep$, 'g');
  src := replace(src, $c$capture_channel = p_channel$c$, $c$capture_channel = ANY(string_to_array(p_channel, ','))$c$);
  EXECUTE src;
END $do$;
