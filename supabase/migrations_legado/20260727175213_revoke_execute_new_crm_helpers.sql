-- Os dois helpers criados em 20260727175211 nasceram com EXECUTE para anon/authenticated.
-- fn_find_lead_by_identity e SECURITY DEFINER e recebe (clinic_id, telefone, email) devolvendo
-- o id do lead: pelo PostgREST, anon poderia sondar QUALQUER clinica e confirmar se um telefone
-- existe na base. Oraculo de PII cross-tenant, com RLS ignorada pelo DEFINER.
--
-- Confirma a regra do CLAUDE.md: o grant vem por DOIS caminhos (o PUBLIC que todo create function
-- concede e o nominal do pg_default_acl). Revogar so de um deixa o outro de pe. E confirma que o
-- alter default privileges de 27/07 NAO cobriu este caso: conferir SEMPRE com
-- has_function_privilege depois de criar funcao, nunca confiar no DDL da migration.
--
-- Estas duas funcoes so sao chamadas de DENTRO de outras funcoes/triggers (que rodam como owner),
-- entao nao precisam de grant nenhum para o front.

revoke all on function public.fn_default_entry_stage(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_find_lead_by_identity(uuid, text, text) from public, anon, authenticated;
