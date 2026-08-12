-- 20260721190637_drop_build_commercial_report_old_signature
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP FUNCTION build_commercial_report(uuid,text,date,date,date,date,date,date,boolean);
