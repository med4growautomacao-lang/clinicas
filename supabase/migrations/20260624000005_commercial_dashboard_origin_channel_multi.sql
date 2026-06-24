-- Multi-seleção de ORIGEM e CANAL no painel Comercial (get_commercial_dashboard).
-- Mesma estratégia da 20260624000004: lista por vírgula em p_origin/p_channel,
-- 'todos' = tudo, retrocompatível. 3 variantes de origem (l.source, source bare,
-- platform), canal (l./bare) e o especial de investimento. AGENTE não muda.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text)'::regprocedure);
  src := regexp_replace(src,
    $re$\(p_origin = 'meta' AND l\.source = 'meta_ads'\)\s+OR\s+\(p_origin = 'google' AND l\.source = 'google_ads'\)\s+OR\s+\(p_origin = 'balcao' AND l\.source = 'balcao'\)\s+OR\s+\(p_origin = 'sem_origem' AND \(l\.source IS NULL OR l\.source NOT IN \('meta_ads', 'google_ads', 'balcao'\)\)\)$re$,
    $rep$(CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))$rep$, 'g');
  src := regexp_replace(src,
    $re$\(p_origin = 'meta' AND source = 'meta_ads'\)\s+OR\s+\(p_origin = 'google' AND source = 'google_ads'\)\s+OR\s+\(p_origin = 'balcao' AND source = 'balcao'\)\s+OR\s+\(p_origin = 'sem_origem' AND \(source IS NULL OR source NOT IN \('meta_ads', 'google_ads', 'balcao'\)\)\)$re$,
    $rep$(CASE WHEN source = 'meta_ads' THEN 'meta' WHEN source = 'google_ads' THEN 'google' WHEN source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))$rep$, 'g');
  src := regexp_replace(src,
    $re$\(p_origin = 'meta' AND platform = 'meta_ads'\)\s+OR\s+\(p_origin = 'google' AND platform = 'google_ads'\)\s+OR\s+\(p_origin = 'balcao' AND platform = 'balcao'\)\s+OR\s+\(p_origin = 'sem_origem' AND \(platform IS NULL OR platform NOT IN \('meta_ads', 'google_ads', 'balcao'\)\)\)$re$,
    $rep$(CASE WHEN platform = 'meta_ads' THEN 'meta' WHEN platform = 'google_ads' THEN 'google' WHEN platform = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))$rep$, 'g');
  src := replace(src, $c$capture_channel = p_channel$c$, $c$capture_channel = ANY(string_to_array(p_channel, ','))$c$);
  src := replace(src, $i$(COALESCE(p_channel, 'todos') <> 'balcao')$i$, $i$(string_to_array(COALESCE(p_channel, 'todos'), ',') <> ARRAY['balcao'])$i$);
  EXECUTE src;
END $do$;
