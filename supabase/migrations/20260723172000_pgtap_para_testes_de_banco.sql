-- pgTAP: testes de banco de verdade. Entra agora porque o Emissor (outbox de saida) tem
-- invariantes que NAO podem ser verificadas por leitura de codigo: nao duplicar envio, preservar
-- a ordem das bolhas por conversa, e (no sandbox) nunca vazar para a uazapi. Sem teste, cada uma
-- dessas so seria descoberta em producao, com paciente real do outro lado.
--
-- Instalado no schema `extensions` (convencao do Supabase): nao polui o `public` nem aparece no
-- PostgREST. Nao altera nenhum objeto existente; e puramente aditivo.
--
-- A suite vive em supabase/tests/emissor.test.sql e roda em transacao com rollback.
create extension if not exists pgtap with schema extensions;
