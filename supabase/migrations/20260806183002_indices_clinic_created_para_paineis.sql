-- Os dois indices que sustentam a correcao de 06/08/2026 dos paineis.
-- Foram criados em producao com CREATE INDEX CONCURRENTLY (fora de transacao, para nao travar
-- escrita numa tabela de 330 MB com paciente mandando mensagem). Aqui ficam registrados na
-- forma comum + IF NOT EXISTS: e no-op no banco atual e corretos num banco reconstruido do zero.
--
-- ⚠️ NAO DROPAR. Sem eles, o filtro de periodo dos paineis volta a ler o historico inteiro da
-- clinica para devolver um mes, e o monitor de WhatsApp desconectado (cron de 5 min) volta a
-- varrer toda a conversa de cada clinica, esvaziando o cache do servidor a cada 5 minutos.
--
-- 🚫 NAO APLIQUE ESTE ARQUIVO NUM BANCO DE CLIENTE NO AR onde o indice ainda nao exista.
-- CREATE INDEX comum (sem CONCURRENTLY) pega lock de escrita na tabela durante toda a construcao.
-- Em chat_messages (330 MB) isso BLOQUEIA o wa-inbound de gravar mensagem de paciente por alguns
-- minutos: o WhatsApp do cliente para de responder e ninguem entende por que. CONCURRENTLY nao
-- cabe aqui porque apply_migration roda tudo dentro de uma transacao.
-- Em banco vazio ou reconstruido do zero, aplicar direto e seguro (nao ha escrita concorrente).
-- Em banco vivo, rode a mao, FORA de transacao, e so depois marque a migration como aplicada:
--   create unique index concurrently ... / create index concurrently ...
create index if not exists idx_chat_messages_clinic_created on public.chat_messages using btree (clinic_id, created_at);
create index if not exists idx_leads_clinic_created         on public.leads         using btree (clinic_id, created_at);
