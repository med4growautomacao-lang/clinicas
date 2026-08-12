-- 20260719024428_cleanup_clint_backfill_staging_tables
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Limpeza das tabelas de staging descartáveis do backfill da Clint (17-18/07).
-- Já consumidas por apply_external_crm_outcome; não são schema do app. As tabelas
-- de rollback do Comercial (comm_snapshot_v1, comm_rollback_ddl) são MANTIDAS de
-- propósito como rede de segurança até validação do painel Comercial no app.
DROP TABLE IF EXISTS public.clint_abertos_20260717;
DROP TABLE IF EXISTS public.clint_backfill_20260717;
DROP TABLE IF EXISTS public.clint_res_20260717;
DROP TABLE IF EXISTS public.clint_res_perd_20260718;
DROP TABLE IF EXISTS public.clint_utm_20260717;
DROP TABLE IF EXISTS public.hist_utm_20260717;
DROP TABLE IF EXISTS public.perd_ano_20260717;
