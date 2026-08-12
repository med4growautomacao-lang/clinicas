-- Multi-seleção de ORIGEM e CANAL na lista de leads do Comercial
-- (get_commercial_leads). Mesma estratégia das 20260624000004/000005.
-- Esta função alinha o espaçamento ('meta'   AND), por isso o regex de origem
-- usa \s+ flexível. AGENTE não muda.
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
