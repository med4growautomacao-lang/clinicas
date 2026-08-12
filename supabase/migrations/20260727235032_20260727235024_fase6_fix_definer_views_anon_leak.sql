-- 20260727235032_20260727235024_fase6_fix_definer_views_anon_leak
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- FASE 6: fecha 2 views SECURITY DEFINER (security_invoker=off) legiveis por anon — mesma classe
-- da vw_lead_active_stage corrigida na fase0. Confirmado por REST com a anon key:
--   vw_n8n_chat_memory  -> anon lia 500.136 mensagens de chat (conteudo de conversa de TODAS as
--                          clinicas); e DEFINER, entao ignorava a RLS de chat_messages.
--   vw_revenue_health   -> anon lia nome + saude financeira agregada de todas as clinicas.
--
-- security_invoker=on faz a view herdar a RLS das tabelas base (chat_messages/financial/conversions/
-- clinics) no papel do chamador. O n8n le vw_n8n_chat_memory por conexao Postgres privilegiada
-- (nao anon/authenticated), entao nao quebra; o front nao usa nenhuma das duas (grep vazio).

alter view public.vw_n8n_chat_memory set (security_invoker = on);
revoke all on table public.vw_n8n_chat_memory from anon, authenticated;

alter view public.vw_revenue_health set (security_invoker = on);
revoke all on table public.vw_revenue_health from anon;
