-- =============================================================================
-- Consistência (code-review #5) — _llm_secret_name(text) segue o padrão REVOKE
-- das RPCs irmãs. Inofensivo (retorna só o mapeamento constante provider→nome),
-- mas destoava do REVOKE/GRANT explícito da migration 000021.
-- =============================================================================
REVOKE ALL ON FUNCTION public._llm_secret_name(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._llm_secret_name(text) TO authenticated, service_role;
