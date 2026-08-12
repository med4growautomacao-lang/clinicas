-- 20260624034008_dashboard_stats_channel_agent
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_dashboard_stats(uuid,date,date,text)'::regprocedure);

  src := replace(src,
    $sig$p_origin text DEFAULT 'todos'::text)$sig$,
    $sig$p_origin text DEFAULT 'todos'::text, p_channel text DEFAULT 'todos'::text, p_agent text DEFAULT 'todos'::text)$sig$);

  src := replace(src,
    $blk$OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads', 'balcao'))))$blk$,
    $blk$OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads', 'balcao'))))
    AND (p_channel = 'todos' OR l.capture_channel = p_channel)
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))$blk$);

  EXECUTE src;
END $do$;

DROP FUNCTION IF EXISTS public.get_dashboard_stats(uuid,date,date,text);
