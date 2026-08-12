-- 20260718051555_revoke_llm_secret_name
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

REVOKE ALL ON FUNCTION public._llm_secret_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._llm_secret_name(text) TO authenticated, service_role;
