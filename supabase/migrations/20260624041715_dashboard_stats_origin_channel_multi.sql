-- 20260624041715_dashboard_stats_origin_channel_multi
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_dashboard_stats(uuid,date,date,text,text,text)'::regprocedure);
  src := regexp_replace(src,
    $re$\(p_origin = 'meta' AND l\.source = 'meta_ads'\)\s+OR\s+\(p_origin = 'google' AND l\.source = 'google_ads'\)\s+OR\s+\(p_origin = 'balcao' AND l\.source = 'balcao'\)\s+OR\s+\(p_origin = 'sem_origem' AND \(l\.source IS NULL OR l\.source NOT IN \('meta_ads', 'google_ads', 'balcao'\)\)\)$re$,
    $rep$(CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))$rep$, 'g');
  src := regexp_replace(src,
    $re$\(p_origin = 'meta' AND platform = 'meta_ads'\)\s+OR\s+\(p_origin = 'google' AND platform = 'google_ads'\)\s+OR\s+\(p_origin = 'balcao' AND platform = 'balcao'\)\s+OR\s+\(p_origin = 'sem_origem' AND \(platform IS NULL OR platform NOT IN \('meta_ads', 'google_ads', 'balcao'\)\)\)$re$,
    $rep$(CASE WHEN platform = 'meta_ads' THEN 'meta' WHEN platform = 'google_ads' THEN 'google' WHEN platform = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))$rep$, 'g');
  src := replace(src, $c$capture_channel = p_channel$c$, $c$capture_channel = ANY(string_to_array(p_channel, ','))$c$);
  EXECUTE src;
END $do$;
