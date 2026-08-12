-- 20260623203729_balcao_zero_investment
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text)'::regprocedure);
  IF position('COALESCE(p_channel, ''todos'') <> ''balcao''' in src) > 0 THEN
    RETURN;
  END IF;
  src := regexp_replace(src,
    '(\(platform IS NULL OR platform NOT IN \(''meta_ads'', ''google_ads'', ''balcao''\)\)\)\))',
    '\1 AND (COALESCE(p_channel, ''todos'') <> ''balcao'')', 'g');
  EXECUTE src;
END $do$;
