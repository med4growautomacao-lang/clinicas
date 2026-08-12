-- 20260715123219_drop_old_import_historical_lead_overload
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP FUNCTION IF EXISTS public.import_historical_lead(
  uuid,text,text,text,text,text,text,text,text,text,
  timestamp without time zone,text,timestamp with time zone,text,jsonb
);
REVOKE ALL ON FUNCTION public.import_historical_lead(
  uuid,text,text,text,text,text,text,text,text,text,
  timestamp without time zone,text,timestamp without time zone,text,jsonb
) FROM anon;
