-- A tela "Configurações Chatbot" não abria: as tabelas nasceram sem GRANT para `authenticated`.
--
-- ⚠️ Tabela nova no Postgres não tem privilégio para ninguém. RLS sozinha NÃO basta: ela filtra
-- LINHA, o grant é que dá o direito de olhar a TABELA. Sem ele o PostgREST devolve vazio (não é
-- erro visível), o componente tenta criar o rascunho, esbarra no índice de unicidade, e a tela
-- fica no "carregando" para sempre. É perda silenciosa: nada acende em lugar nenhum.
--
-- Concedido SÓ para `authenticated`, nunca para `anon`: a régua da casa desde o hardening de 27/07
-- é default-deny, e contato anônimo não tem o que fazer com o roteiro de nenhuma clínica.
-- O escopo por clínica continua sendo das policies (my_clinic_ids / is_super_admin).

grant select, insert, update on public.chatbot_scripts  to authenticated;
grant select                 on public.chatbot_versions to authenticated;

-- chatbot_sessions e chatbot_events seguem backend-only de propósito: a tela lê os números pela
-- RPC get_chatbot_funnel (SECURITY DEFINER, com assert_clinic_access), e não pela tabela crua.
