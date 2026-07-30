-- Backup reversivel das 45 copias que o import do onboarding gravou em cima do envio proprio do
-- sistema (Lorena, 29/07). A tabela foi criada por `create table as select ... where false` +
-- insert dos ids conferidos (todos casando com outbound_messages.provider_message_id depois do
-- prefixo '<jid>:'), e as linhas foram apagadas de chat_messages em seguida.
--
-- A tabela guarda CONVERSA DE PACIENTE. Tabela nova em `public` nasce visivel pelo PostgREST e o
-- ACL default de TABELAS ja deu CRUD a anon uma vez neste projeto (fase1b do hardening, 27/07).
-- Fecha antes de qualquer coisa: RLS ligada sem policy nenhuma = ninguem le, e os grants nominais
-- revogados nos DOIS caminhos (PUBLIC e nominal), como manda a regra do CLAUDE.md para funcao e
-- vale igual para tabela.
--
-- Pode ser descartada depois de conferido o painel da clinica.
create table if not exists public.chat_messages_dup_import_20260730 as
select cm.* from public.chat_messages cm where false;

comment on table public.chat_messages_dup_import_20260730 is
  'Backup reversivel das copias que o import do onboarding gravou em cima do envio proprio do sistema (30/07/2026). Cada linha aqui e duplicata de uma mensagem que o Emissor entregou (id casa com outbound_messages.provider_message_id depois do prefixo). Pode ser descartada depois de conferido o painel da clinica.';

alter table public.chat_messages_dup_import_20260730 enable row level security;
revoke all on table public.chat_messages_dup_import_20260730 from public, anon, authenticated;
grant select, delete on table public.chat_messages_dup_import_20260730 to service_role;
